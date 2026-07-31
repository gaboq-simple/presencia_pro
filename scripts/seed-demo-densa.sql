-- ─── Seed "barbería densa" para la BD demo ────────────────────────────────────
--
-- Resetea el negocio demo a un estado DENSO y conocido, pensado para:
--   · enseñar el producto a barberías reales (datos creíbles, no ceros), y
--   · diagnosticar/diseñar vistas con densidad real (dueño-v3).
--
-- Qué deja: 5 barberos con horarios distintos (uno con hora de comida, uno de
-- medio tiempo), 8 servicios ($80–$550), ~120 clientes, ~3 meses de citas hacia
-- atrás y ~1 semana hacia adelante, con no-shows (3 reincidentes en el mes),
-- walk-ins, cancelaciones, ~12 clientes "enfriándose" (sin visitas recientes,
-- alimentan "Para recuperar"), días libres y bloqueos aprobados.
--
-- Propiedades:
--   · IDEMPOTENTE: purga las citas del negocio y re-siembra. Correrlo dos veces
--     el mismo día produce el mismo estado (pseudo-aleatorio por hash md5, sin
--     random()). Staff/servicios/clientes se crean solo si faltan.
--   · RELATIVO A HOY: las fechas se calculan contra la fecha actual en la
--     timezone del negocio — corre igual de fresco cualquier día.
--   · SIN RUIDO DE AUDIT: todo entra por INSERT con valores finales (cero
--     UPDATEs sobre appointments) y al final limpia las filas viejas de
--     appointment_audit con actor desconocido ("Acción sin identificar").
--   · NO TOCA: bot_conversations, conversation_messages, bot_logs, businesses,
--     appointment_tips, ni los horarios ya cargados de barberos existentes.
--
-- ⚠️ DESTRUCTIVO para el negocio objetivo: borra TODAS sus citas, waitlist,
--    scheduled_notifications y su appointment_audit. Solo para la BD demo.
--
-- Uso (psql, con el session pooler como en scripts/backup-supabase.sh):
--   psql "$SUPABASE_DB_URL" -f scripts/seed-demo-densa.sql
-- O pegar el archivo completo en el SQL editor de Supabase / MCP execute_sql.
-- Para otro negocio: cambiar el slug en seed_cfg (única línea de configuración).

-- ─── Configuración ────────────────────────────────────────────────────────────
create temp table seed_cfg as
select 'barberia-demo'::text as slug;

-- Pseudo-aleatorio determinista: texto → uniforme [0,1).
create function pg_temp.h(txt text) returns double precision as $$
  select (('x' || substr(md5(txt), 1, 8))::bit(32)::bigint & 2147483647) / 2147483648.0
$$ language sql immutable;

do $$
begin
  if not exists (select 1 from businesses b join seed_cfg c on b.slug = c.slug) then
    raise exception 'No existe un negocio con slug %', (select slug from seed_cfg);
  end if;
end $$;

create temp table seed_biz as
select b.id, b.timezone, (now() at time zone b.timezone)::date as hoy,
       (now() at time zone b.timezone) as ahora_local
from businesses b join seed_cfg c on b.slug = c.slug;

-- ─── 1. PURGA (orden por FKs: audit/notifs → citas → waitlist) ────────────────
-- appointment_audit es append-only (trg_appt_audit_immutable bloquea DELETE).
-- SOLO en la demo se suspende ese trigger durante la purga; en producción este
-- script no debe correrse. Se re-habilita al final del archivo.
alter table appointment_audit disable trigger trg_appt_audit_immutable;
delete from appointment_audit       where business_id = (select id from seed_biz);
delete from scheduled_notifications where business_id = (select id from seed_biz);
delete from waitlist                where business_id = (select id from seed_biz);
delete from appointments            where business_id = (select id from seed_biz);
-- Excepciones/bloqueos creados por corridas anteriores de ESTE seed (por reason).
delete from staff_schedule_exceptions e
using staff s
where e.staff_id = s.id and s.business_id = (select id from seed_biz)
  and e.reason in ('Trámite personal', 'Día libre', 'Vacaciones');
delete from staff_blocks k
using staff s
where k.staff_id = s.id and s.business_id = (select id from seed_biz)
  and k.reason in ('Compromiso familiar', 'Cita médica');

-- ─── 2. Servicios (crear los que falten, por nombre) ──────────────────────────
insert into services (business_id, name, description, duration_minutes, price, currency, active)
select b.id, v.name, v.descr, v.dur, v.price, 'MXN', true
from seed_biz b,
     (values
       ('Corte de cabello',         'Corte clásico',                              30, 200),
       ('Corte + barba',            'Corte completo con arreglo de barba',        45, 320),
       ('Barba / afeitado clásico', 'Afeitado con toalla caliente',               30, 180),
       ('Corte niño',               'Menores de 12 años',                         30, 150),
       ('Tinte / color',            'Aplicación de color',                        60, 550),
       ('Tratamiento capilar',      'Hidratación y tratamiento',                  45, 400),
       ('Corte premium',            'Corte + lavado + toalla caliente + styling', 60, 450),
       ('Delineado',                'Delineado de ceja y línea',                  15,  80)
     ) as v(name, descr, dur, price)
where not exists (
  select 1 from services s
  where s.business_id = b.id and lower(s.name) = lower(v.name)
);

-- ─── 3. Barberos (crear los que falten, por nombre) ───────────────────────────
-- phone/whatsapp_id son NOT NULL en la BD real; pins únicos por convención.
insert into staff (business_id, name, phone, whatsapp_id, role, active, pin)
select b.id, v.name, v.phone, v.phone, 'barber', true, v.pin
from seed_biz b,
     (values
       ('Carlos', '15551112222', '1234'),
       ('Andrés', '15553334444', '4321'),
       ('Miguel', '15556667777', '2468'),
       ('Beto',   '15557778888', '1357'),
       ('Diego',  '15558889999', '9753')
     ) as v(name, phone, pin)
where not exists (
  select 1 from staff s
  where s.business_id = b.id and lower(s.name) = lower(v.name) and s.role = 'barber'
);

-- Horario canónico SOLO para barberos sin horario cargado (no pisa lo ajustado a mano).
-- Carlos: Lun–Vie 10–20, Sáb 10–18 · Andrés: Mar–Sáb 12–21 ·
-- Miguel: Lun–Sáb 10–19 (comida 14–15) · Beto: Mar–Sáb 11–20 · Diego: Lun/Jue/Vie/Sáb 12–20.
insert into staff_availability (staff_id, day_of_week, start_time, end_time, break_start, break_end, is_active)
select s.id, v.dow, v.st::time, v.en::time, v.bs::time, v.be::time, true
from seed_biz b
join staff s on s.business_id = b.id and s.role = 'barber'
join (values
  ('Carlos', 1, '10:00', '20:00', null, null), ('Carlos', 2, '10:00', '20:00', null, null),
  ('Carlos', 3, '10:00', '20:00', null, null), ('Carlos', 4, '10:00', '20:00', null, null),
  ('Carlos', 5, '10:00', '20:00', null, null), ('Carlos', 6, '10:00', '18:00', null, null),
  ('Andrés', 2, '12:00', '21:00', null, null), ('Andrés', 3, '12:00', '21:00', null, null),
  ('Andrés', 4, '12:00', '21:00', null, null), ('Andrés', 5, '12:00', '21:00', null, null),
  ('Andrés', 6, '12:00', '21:00', null, null),
  ('Miguel', 1, '10:00', '19:00', '14:00', '15:00'), ('Miguel', 2, '10:00', '19:00', '14:00', '15:00'),
  ('Miguel', 3, '10:00', '19:00', '14:00', '15:00'), ('Miguel', 4, '10:00', '19:00', '14:00', '15:00'),
  ('Miguel', 5, '10:00', '19:00', '14:00', '15:00'), ('Miguel', 6, '10:00', '19:00', '14:00', '15:00'),
  ('Beto',   2, '11:00', '20:00', null, null), ('Beto',   3, '11:00', '20:00', null, null),
  ('Beto',   4, '11:00', '20:00', null, null), ('Beto',   5, '11:00', '20:00', null, null),
  ('Beto',   6, '11:00', '20:00', null, null),
  ('Diego',  1, '12:00', '20:00', null, null), ('Diego',  4, '12:00', '20:00', null, null),
  ('Diego',  5, '12:00', '20:00', null, null), ('Diego',  6, '12:00', '20:00', null, null)
) as v(name, dow, st, en, bs, be) on lower(v.name) = lower(s.name)
where not exists (select 1 from staff_availability a where a.staff_id = s.id);

-- Qué servicio hace cada barbero (subconjuntos realistas).
insert into staff_services (staff_id, service_id)
select s.id, sv.id
from seed_biz b
join staff s on s.business_id = b.id and s.role = 'barber'
  and lower(s.name) in ('carlos', 'andrés', 'miguel', 'beto', 'diego')
join services sv on sv.business_id = b.id
where sv.name in ('Corte de cabello', 'Corte + barba', 'Barba / afeitado clásico')
   or (sv.name = 'Corte niño'          and lower(s.name) in ('carlos', 'diego'))
   or (sv.name = 'Tinte / color'       and lower(s.name) in ('miguel'))
   or (sv.name = 'Tratamiento capilar' and lower(s.name) in ('miguel', 'beto'))
   or (sv.name = 'Corte premium'       and lower(s.name) in ('carlos', 'andrés'))
   or (sv.name = 'Delineado'           and lower(s.name) in ('andrés', 'miguel', 'beto', 'diego'))
on conflict do nothing;

-- ─── 4. Clientes (84 con teléfono determinista; se crean solo si faltan) ──────
insert into customers (business_id, name, phone, created_at)
select b.id, p.full_name, '52155' || (41000000 + p.rn)::text,
       now() - interval '95 days'   -- se afina al final con su primera cita
from seed_biz b,
     lateral (
       select n.nombre || ' ' || a.apellido as full_name,
              row_number() over (order by md5(n.nombre || a.apellido)) as rn
       from unnest(array['Luis','Fernando','Alejandro','Ricardo','Emilio','Sergio','Héctor',
         'Arturo','Pablo','Mauricio','Andrés','Gerardo','Iván','Óscar','Raúl','Marco','Adrián',
         'Tomás','Felipe','Hugo','Rubén','Ernesto','Salvador','Rodolfo','Ramón','Gustavo',
         'Alfredo','Enrique','Armando','Julián','Esteban','Leonardo','Manuel','Francisco',
         'Jorge','Alberto','Eduardo','Daniel','Samuel','Benjamín','Damián','Matías']) n(nombre)
       cross join unnest(array['Hernández','Martínez','González','Rodríguez','Sánchez',
         'Ramírez','Cruz','Flores','Gómez','Vargas','Castillo','Jiménez','Morales','Reyes',
         'Gutiérrez','Ortiz','Chávez','Ruiz','Mendoza','Aguilar']) a(apellido)
     ) p
where p.rn <= 84
on conflict (business_id, phone) do nothing;

-- Listas de asignación: todos / "fríos" (12 que dejan de venir hace ~6 semanas).
create temp table seed_cust as
select c.id, c.name,
       row_number() over (order by md5(c.id::text)) as rn,
       pg_temp.h(c.id::text || ':cool') as cool_score
from customers c join seed_biz b on c.business_id = b.id;

create temp table seed_cold as
select id from seed_cust order by cool_score limit 12;

create temp table seed_warm as
select id, name, row_number() over (order by rn) as rn
from seed_cust where id not in (select id from seed_cold);

-- 3 reincidentes de no-show del mes en curso (para "Faltas repetidas").
create temp table seed_flaky as
select id, name, row_number() over (order by pg_temp.h(id::text || ':flaky')) as rn
from seed_warm limit 3;

-- ─── 5. Citas: hoy-90 → hoy+7, grid horario sobre el horario real ─────────────
-- Llenado = base del barbero × día de semana × mes × (futuro al 45%), decidido por
-- hash del slot → determinista y sin solapes (una cita por barbero-hora como máximo).
insert into appointments (business_id, staff_id, service_id, customer_id, starts_at, ends_at,
                          status, source, booking_name, price_charged, arrived_at, completed_at, created_at)
select
  g.business_id, g.staff_id, g.service_id, g.customer_id, g.starts_utc,
  g.starts_utc + make_interval(mins => g.dur),
  g.status,
  case
    when g.status = 'completed' and g.r_source > 0.82 then 'walkin'
    when g.r_source < 0.50 then 'bot'
    else 'manual'
  end,
  g.cust_name,
  case when g.status = 'completed' then g.price end,
  case when g.status = 'completed'
       then g.starts_utc - make_interval(mins => (g.r_arrive * 10)::int) end,
  case when g.status = 'completed'
       then g.starts_utc + make_interval(mins => g.dur + (g.r_arrive * 5)::int) end,
  g.starts_utc - interval '2 days'
from (
  select
    b.id as business_id, sl.staff_id, sl.starts_utc, sl.d, sl.hh,
    sv.service_id, sv.dur, sv.price,
    cu.cust_id as customer_id, cu.cust_name,
    pg_temp.h(sl.key || ':src')    as r_source,
    pg_temp.h(sl.key || ':arrive') as r_arrive,
    case
      when sl.d < b.hoy then
        case when pg_temp.h(sl.key || ':st') < 0.82 then 'completed'
             when pg_temp.h(sl.key || ':st') < 0.90 then 'no_show'
             else 'cancelled' end
      when sl.d = b.hoy then
        case when (sl.d::timestamp + make_time(sl.hh, 0, 0) + make_interval(mins => sv.dur))
                  <= b.ahora_local
             then 'completed' else 'confirmed' end
      else case when pg_temp.h(sl.key || ':st') < 0.70 then 'confirmed' else 'pending' end
    end as status
  from seed_biz b
  cross join generate_series((select hoy from seed_biz) - 90, (select hoy from seed_biz) + 7, interval '1 day') dd(d)
  join lateral (select dd.d::date as d) dx on true
  join staff s on s.business_id = b.id and s.role = 'barber' and s.active
  join staff_availability a
    on a.staff_id = s.id and a.is_active
   and a.day_of_week = extract(dow from dx.d)::int
  cross join lateral generate_series(
    extract(hour from a.start_time)::int,
    extract(hour from a.end_time)::int - 1
  ) hh(hh)
  join lateral (
    select dx.d as d, hh.hh as hh, s.id as staff_id,
           s.id || ':' || dx.d || ':' || hh.hh as key,
           (dx.d::timestamp + make_time(hh.hh, 0, 0)) at time zone b.timezone as starts_utc
  ) sl on true
  -- servicio: entre los que hace ese barbero, muestreo ponderado por hash
  cross join lateral (
    select ss.service_id, s2.duration_minutes as dur, s2.price
    from staff_services ss
    join services s2 on s2.id = ss.service_id and s2.active
    where ss.staff_id = s.id
    order by power(pg_temp.h(sl.key || ':svc:' || s2.id),
                   1.0 / (case s2.name
                     when 'Corte de cabello' then 45 when 'Corte + barba' then 22
                     when 'Barba / afeitado clásico' then 10 when 'Corte niño' then 6
                     when 'Corte premium' then 7 when 'Tinte / color' then 4
                     when 'Tratamiento capilar' then 3 else 3 end)) desc
    limit 1
  ) sv
  -- cliente: sesgo power 1.3 (pocos campeones, cola larga). En los últimos 40 días
  -- solo clientes "warm" (los fríos dejan de venir → alimentan "Para recuperar").
  cross join lateral (
    select w.id as cust_id, w.name as cust_name
    from seed_warm w
    where sl.d >= b.hoy - 40
      and w.rn = 1 + floor(power(pg_temp.h(sl.key || ':cust'), 1.3)
                           * (select count(*) from seed_warm))::int
    union all
    select c.id, c.name
    from seed_cust c
    where sl.d < b.hoy - 40
      and c.rn = 1 + floor(power(pg_temp.h(sl.key || ':cust'), 1.3)
                           * (select count(*) from seed_cust))::int
    limit 1
  ) cu
  -- comida del barbero + decisión de llenado del slot
  where (a.break_start is null
         or make_time(sl.hh, 0, 0) < a.break_start
         or make_time(sl.hh, 0, 0) >= a.break_end)
    and pg_temp.h(sl.key || ':fill') <
        least(0.95,
          (case lower(s.name) when 'carlos' then 0.72 when 'andrés' then 0.58
                              when 'miguel' then 0.62 when 'beto' then 0.48 else 0.42 end)
          * (case extract(dow from sl.d)::int
               when 1 then 0.55 when 2 then 0.70 when 3 then 0.75
               when 4 then 0.85 when 5 then 1.00 else 1.05 end)
          * (case when sl.d < b.hoy - 60 then 0.75
                  when sl.d < b.hoy - 30 then 0.90 else 1.00 end)
          * (case when sl.d > b.hoy then 0.45 when sl.d = b.hoy then 0.75 else 1.00 end))
) g;

-- No-shows del mes en curso → concéntralos en los 3 reincidentes (2 de cada 3).
with mes as (
  select a.id, row_number() over (order by a.starts_at) as rn
  from appointments a join seed_biz b on a.business_id = b.id
  where a.status = 'no_show'
    and a.starts_at >= date_trunc('month', b.hoy)::timestamp at time zone b.timezone
),
destino as (
  select m.id as appt_id, f.id as cust_id, f.name
  from mes m join seed_flaky f on f.rn = 1 + (m.rn % 3)
  where m.rn % 3 <> 2    -- deja ~1/3 repartido en el resto
)
update appointments a
set customer_id = d.cust_id, booking_name = d.name
from destino d where a.id = d.appt_id;

-- ─── 6. Días libres y bloqueos (relativos a hoy) ──────────────────────────────
insert into staff_schedule_exceptions (staff_id, business_id, exception_date, available, reason)
select s.id, b.id, b.hoy + v.off, false, v.reason
from seed_biz b
join staff s on s.business_id = b.id
join (values ('Miguel', 4, 'Trámite personal'),
             ('Beto',   2, 'Día libre'),
             ('Diego', -3, 'Vacaciones'),
             ('Diego', -6, 'Vacaciones')) v(name, off, reason)
  on lower(v.name) = lower(s.name)
on conflict (staff_id, exception_date) do nothing;

insert into staff_blocks (staff_id, starts_at, ends_at, reason, status, urgent)
select s.id,
       (b.hoy + v.off)::timestamp at time zone b.timezone + v.st,
       (b.hoy + v.off)::timestamp at time zone b.timezone + v.en,
       v.reason, 'approved', false
from seed_biz b
join staff s on s.business_id = b.id
join (values ('Andrés', 2, interval '16 hours', interval '21 hours', 'Compromiso familiar'),
             ('Carlos', 5, interval '10 hours', interval '13 hours', 'Cita médica')) v(name, off, st, en, reason)
  on lower(v.name) = lower(s.name);

-- ─── 7. Stats de clientes (el trigger solo corre en UPDATE, no en el seed) ────
with agg as (
  select a.customer_id,
         count(*) filter (where a.status = 'completed')                 as vc,
         max(a.completed_at) filter (where a.status = 'completed')      as lv,
         count(*) filter (where a.status = 'no_show')                   as ns,
         min(a.starts_at)                                               as primera
  from appointments a join seed_biz b on a.business_id = b.id
  where a.customer_id is not null
  group by a.customer_id
)
update customers c
set visit_count  = coalesce(g.vc, 0),
    last_visit   = g.lv,
    noshow_count = coalesce(g.ns, 0),
    is_flagged   = coalesce(g.ns, 0) >= (select max_noshows_before_flag
                                         from businesses where id = (select id from seed_biz)),
    created_at   = least(c.created_at, g.primera - interval '1 day')
from agg g where c.id = g.customer_id;

-- Clientes del negocio sin ninguna cita tras la purga → stats en cero coherentes.
update customers c
set visit_count = 0, last_visit = null, noshow_count = 0, is_flagged = false
where c.business_id = (select id from seed_biz)
  and not exists (select 1 from appointments a where a.customer_id = c.id);

-- ─── 8. Limpieza del audit "Acción sin identificar" ───────────────────────────
-- Los UPDATEs de este seed (reincidentes, paso 5) y cualquier SQL ad-hoc previo
-- dejan filas de audit con actor desconocido que ensucian Actividad. Fuera.
delete from appointment_audit
where business_id = (select id from seed_biz)
  and actor_staff_id is null
  and coalesce(actor_type, '') not in ('bot');

-- Restaurar la inmutabilidad del audit (suspendida al inicio de la purga).
alter table appointment_audit enable trigger trg_appt_audit_immutable;

-- ─── Resumen ──────────────────────────────────────────────────────────────────
select
  (select count(*) from staff s    join seed_biz b on s.business_id = b.id and s.role = 'barber' and s.active) as barberos,
  (select count(*) from services s join seed_biz b on s.business_id = b.id where s.active)                     as servicios,
  (select count(*) from customers c join seed_biz b on c.business_id = b.id)                                   as clientes,
  (select count(*) from appointments a join seed_biz b on a.business_id = b.id)                                as citas,
  (select count(*) from appointments a join seed_biz b on a.business_id = b.id where a.status = 'no_show')     as no_shows,
  (select count(*) from appointments a join seed_biz b on a.business_id = b.id
    where a.starts_at >= (b.hoy + 1)::timestamp at time zone b.timezone)                                       as futuras;
