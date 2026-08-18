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
-- Y la CAJA (D1b): riel de cobro en las citas cobradas, ~30 días de movimientos
-- fuera de agenda y ~4 semanas de cortes con descuadres chicos de signo MIXTO.
-- Sin esa capa, la pieza que más diferencia —el cuadre— se ve vacía justo en las
-- demos de venta, y la red visual de D4/D5 fotografiaría estados vacíos y los
-- aprobaría como correctos.
--
-- Propiedades:
--   · IDEMPOTENTE: purga las citas del negocio y re-siembra. Pseudo-aleatorio por
--     hash md5, sin random(); staff/servicios/clientes se crean solo si faltan.
--   · RELATIVO A HOY: las fechas se calculan contra la fecha actual en la
--     timezone del negocio — corre igual de fresco cualquier día.
--   · DETERMINISTA, PERO EL DÍA DE HOY DEPENDE DE LA HORA DE CORRIDA (dv3-5').
--     Las citas de HOY nacen `completed` (con `price_charged`, `payment_method`,
--     `arrived_at` y `completed_at`) si su hora de FIN ya pasó al momento de
--     correr, y `confirmed` si no — ver la regla `sl.d = b.hoy` más abajo. O sea:
--     dos corridas a la misma hora dan el mismo estado, y dos corridas a horas
--     distintas del mismo día NO, a propósito.
--
--     Medido el 2026-08-18: corridas de 16:20 y 16:22 → huellas md5 de contenido
--     IDÉNTICAS en los tres tramos (pasado `d91d8036…`, hoy `33759af0…`, futuro
--     `cf6d68db…`); entre 16:19 y 16:20 cambió SOLO la de hoy, porque se cruzó el
--     fin de una cita. El pasado y el futuro no dependen de la hora.
--
--     Consecuencia práctica: la corrida automática de las 05:00 CDMX deja el día
--     ENTERO en `confirmed` —a esa hora no terminó nada— y para media tarde el
--     dueño ve $0 y un puñado de no-shows, porque el cron de auto-cancel fue
--     marcando lo vencido. **Antes de una demo, disparar el workflow a mano**
--     (`gh workflow run reseed-demo.yml`, o Actions → Reseed demo barbershop →
--     Run workflow): el día se refresca con dinero de verdad. Verificado: a las
--     05:20 el día daba 0 completadas / $0; re-sembrado 16:19, 3 completadas /
--     $460, las tres con riel de cobro.
--
--     Al comparar dos corridas, la huella va sobre el CONTENIDO (starts_at,
--     status, price_charged, payment_method, source, booking_name), nunca sobre
--     los `id`: los ids se regeneran en cada corrida por diseño.
--   · Y LA HUELLA DEL MES DEPENDE DE LA FECHA DE CORRIDA (dv3-6). El bloque 8b
--     ("altas del mes en curso") elige cuántos clientes nacen este mes en función
--     de los días transcurridos del mes, así que dos corridas del día 5 dan lo
--     mismo y una del 5 contra una del 20 no. Resumen de las tres escalas:
--       – el PASADO y el FUTURO no dependen de nada (mismos en cualquier corrida);
--       – el DÍA de hoy depende de la HORA de corrida (qué citas ya terminaron);
--       – el MES depende de la FECHA de corrida (cuántas altas caben en él).
--   · SIN RUIDO DE AUDIT: todo entra por INSERT con valores finales (cero
--     UPDATEs sobre appointments) y al final limpia las filas viejas de
--     appointment_audit con actor desconocido ("Acción sin identificar").
--   · NO TOCA: bot_conversations, conversation_messages, bot_logs,
--     appointment_tips, ni los horarios ya cargados de barberos existentes.
--     ÚNICA excepción en businesses: `caja_fondo` (config numérica del fondo de
--     cambio, idempotente — la capa de dinero la necesita para que el descuadre
--     de efectivo no cargue un offset sistemático).
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

-- Caja (D1b). Las dos tablas son append-only por trigger (migración
-- 20260812000000): igual que con el audit, SOLO en la demo se suspenden para la
-- purga y se re-habilitan de inmediato — el resto del seed solo inserta.
alter table caja_movimientos disable trigger trg_caja_mov_immutable;
alter table caja_cortes      disable trigger trg_caja_cortes_immutable;
delete from caja_cortes      where business_id = (select id from seed_biz);
delete from caja_movimientos where business_id = (select id from seed_biz);
alter table caja_movimientos enable trigger trg_caja_mov_immutable;
alter table caja_cortes      enable trigger trg_caja_cortes_immutable;

-- Fondo de cambio del cajón. ÚNICA columna de businesses que este seed toca
-- (ver encabezado): sin fondo, el esperado de efectivo del corte queda corrido
-- por la misma cantidad todos los días y el descuadre deja de significar algo.
update businesses set caja_fondo = 500 where id = (select id from seed_biz);

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
                          status, source, booking_name, price_charged, arrived_at, completed_at, created_at,
                          payment_method)
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
  g.starts_utc - interval '2 days',
  -- Riel de cobro (D1b): solo en lo cobrado. Mezcla ≈75/22/3 — el efectivo domina
  -- en barbería, y esa proporción es la que hace que el descuadre de efectivo sea
  -- la señal interesante. El hash va sobre la clave del SLOT, no sobre el id de la
  -- cita: los ids se regeneran en cada corrida y romperían el determinismo.
  case when g.status = 'completed' then
    case when g.r_pay < 0.75 then 'efectivo'
         when g.r_pay < 0.97 then 'tarjeta'
         else 'transferencia' end
  end
from (
  select
    b.id as business_id, sl.staff_id, sl.starts_utc, sl.d, sl.hh,
    sv.service_id, sv.dur, sv.price,
    cu.cust_id as customer_id, cu.cust_name,
    pg_temp.h(sl.key || ':src')    as r_source,
    pg_temp.h(sl.key || ':arrive') as r_arrive,
    pg_temp.h(sl.key || ':pay')    as r_pay,
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

-- ─── 7. Caja: movimientos fuera de agenda (~30 días) ──────────────────────────
-- El dinero que no pasa por la agenda. Sin él, el descuadre POSITIVO (ingreso sin
-- capturar) sería indistinguible de un error de conteo, que es justo la confusión
-- que la capa de dinero existe para deshacer.
-- Determinismo: el hash va sobre (día, índice) — nada de ids regenerados.
create temp table seed_barberos as
select s.id, row_number() over (order by s.name) as rn, (count(*) over ())::int as total
from staff s join seed_biz b on s.business_id = b.id
where s.role = 'barber' and s.active;

insert into caja_movimientos (business_id, type, amount, method, concept, note,
                              staff_id, occurred_on, created_at)
select
  b.id, 'entrada',
  case when m.r_con < 0.60
       then round((100 + m.r_amt * 150)::numeric, 0)     -- walk-in  $100–$250
       else round(( 80 + m.r_amt * 320)::numeric, 0) end,-- producto $80–$400
  case when m.r_met < 0.70 then 'efectivo'
       when m.r_met < 0.95 then 'tarjeta' else 'transferencia' end,
  case when m.r_con < 0.60 then 'walkin' else 'producto' end,
  null,
  (select id from seed_barberos where rn = 1 + floor(m.r_bar * (select total from seed_barberos limit 1))::int),
  m.d,
  (m.d::timestamp + interval '13 hours' + make_interval(hours => m.idx)) at time zone b.timezone
from seed_biz b
cross join lateral (
  select dd.d::date as d, i.idx,
         pg_temp.h(dd.d::text || ':mov:' || i.idx)          as r_gate,
         pg_temp.h(dd.d::text || ':mov:' || i.idx || ':c')  as r_con,
         pg_temp.h(dd.d::text || ':mov:' || i.idx || ':a')  as r_amt,
         pg_temp.h(dd.d::text || ':mov:' || i.idx || ':m')  as r_met,
         pg_temp.h(dd.d::text || ':mov:' || i.idx || ':b')  as r_bar
  from generate_series(b.hoy - 29, b.hoy, interval '1 day') dd(d)
  cross join generate_series(0, 2) i(idx)
) m
-- 0–3 por día: compuerta decreciente por índice → ~1.6 movimientos/día de promedio.
where extract(dow from m.d)::int <> 0
  and m.r_gate < (case m.idx when 0 then 0.75 when 1 then 0.55 else 0.30 end);

-- Salidas: 1–2 por semana (insumos o retiro). Son las que hacen que el descuadre
-- negativo tenga una explicación posible además de "falta dinero".
insert into caja_movimientos (business_id, type, amount, method, concept, note,
                              staff_id, occurred_on, created_at)
select
  b.id, 'salida',
  round((60 + s.r_amt * 140)::numeric, 0),                 -- $60–$200
  case when s.r_met < 0.80 then 'efectivo' else 'tarjeta' end,
  case when s.r_con < 0.60 then 'insumos' else 'retiro' end,
  null,
  (select id from seed_barberos where rn = 1 + floor(s.r_bar * (select total from seed_barberos limit 1))::int),
  s.d,
  (s.d::timestamp + interval '19 hours') at time zone b.timezone
from seed_biz b
cross join lateral (
  select dd.d::date as d,
         pg_temp.h(dd.d::text || ':sal')      as r_gate,
         pg_temp.h(dd.d::text || ':sal:c')    as r_con,
         pg_temp.h(dd.d::text || ':sal:a')    as r_amt,
         pg_temp.h(dd.d::text || ':sal:m')    as r_met,
         pg_temp.h(dd.d::text || ':sal:b')    as r_bar
  from generate_series(b.hoy - 29, b.hoy, interval '1 day') dd(d)
) s
where extract(dow from s.d)::int <> 0
  and s.r_gate < 0.22;

-- ─── 8. Caja: cortes de las últimas ~4 semanas, con huecos ────────────────────
-- El esperado se calcula con la MISMA regla que usará lib/corte.ts (D5): día de
-- caja de una cita = fecha LOCAL de completed_at (el dinero cuenta cuando se
-- cobró), efectivo lleva el fondo y la tarjeta no, y las transferencias quedan
-- FUERA de la comparación (no hay artefacto físico que contar).
--
-- Huecos a propósito: domingos (cerrado), ~1 día hábil por semana por hash, y HOY
-- sin corte — para poder capturarlo EN VIVO durante una demo.
-- El ruido del conteo es de SIGNO MIXTO (−$80…+$80): un cuadre perfecto todos los
-- días es la señal de teatro que el propio plan vigila, así que el seed no la
-- fabrica.
insert into caja_cortes (business_id, corte_date, staff_id, cash_counted, card_counted,
                         expected_cash, expected_card, fondo_snapshot, created_at)
select
  b.id, c.d,
  (select id from seed_barberos where rn = 1 + floor(c.r_bar * (select total from seed_barberos limit 1))::int),
  greatest(0, c.exp_cash + c.ruido_cash),
  greatest(0, c.exp_card + c.ruido_card),
  c.exp_cash, c.exp_card, 500,
  (c.d::timestamp + interval '21 hours 30 minutes') at time zone b.timezone
from seed_biz b
cross join lateral (
  select
    dd.d::date as d,
    pg_temp.h(dd.d::text || ':corte:b') as r_bar,
    round(((pg_temp.h(dd.d::text || ':corte:rc') - 0.5) * 160)::numeric, 0) as ruido_cash,
    round(((pg_temp.h(dd.d::text || ':corte:rt') - 0.5) * 160)::numeric, 0) as ruido_card,
    pg_temp.h(dd.d::text || ':corte:skip') as r_skip,
    500
      + coalesce((select sum(a.price_charged) from appointments a
                   where a.business_id = b.id and a.status = 'completed'
                     and a.payment_method = 'efectivo'
                     and (a.completed_at at time zone b.timezone)::date = dd.d::date), 0)
      + coalesce((select sum(m.amount) from caja_movimientos m
                   where m.business_id = b.id and m.occurred_on = dd.d::date
                     and m.type = 'entrada' and m.method = 'efectivo'), 0)
      - coalesce((select sum(m.amount) from caja_movimientos m
                   where m.business_id = b.id and m.occurred_on = dd.d::date
                     and m.type = 'salida' and m.method = 'efectivo'), 0)
      as exp_cash,
        coalesce((select sum(a.price_charged) from appointments a
                   where a.business_id = b.id and a.status = 'completed'
                     and a.payment_method = 'tarjeta'
                     and (a.completed_at at time zone b.timezone)::date = dd.d::date), 0)
      + coalesce((select sum(m.amount) from caja_movimientos m
                   where m.business_id = b.id and m.occurred_on = dd.d::date
                     and m.type = 'entrada' and m.method = 'tarjeta'), 0)
      - coalesce((select sum(m.amount) from caja_movimientos m
                   where m.business_id = b.id and m.occurred_on = dd.d::date
                     and m.type = 'salida' and m.method = 'tarjeta'), 0)
      as exp_card
  from generate_series(b.hoy - 27, b.hoy - 1, interval '1 day') dd(d)
) c
where extract(dow from c.d)::int <> 0     -- domingo: cerrado, no hay qué contar
  and c.r_skip >= 0.18;                   -- ~1 día hábil por semana sin corte

-- ─── 8b. Altas del MES EN CURSO (dv3-6) ──────────────────────────────────────
-- Sin esto, el "+N este mes" del héroe de Clientela es 0 para siempre: los 125
-- clientes nacían todos al principio de la ventana de 90 días, así que el
-- crecimiento —la pregunta que abre esa pestaña— se veía muerto en cada demo.
--
-- No se inventan clientes ni citas: se ELIGE un subconjunto por hash y se le
-- borra la historia anterior al mes en curso, de modo que su primera visita caiga
-- dentro del mes. Un cliente cuya primera cita es de este mes ES un alta de este
-- mes; no hay nada que fabricar. Al quitar filas (nunca agregarlas) no se puede
-- crear un solape, que es el riesgo de sembrar citas fuera del grid.
--
-- ⚠️ La cantidad ESCALA con los días transcurridos del mes, y es a propósito:
-- correr el seed un día 2 y ver "9 altas" apretadas en 48 h sería menos creíble
-- que verlo vacío. ~0.3 altas por día transcurrido, con piso 2 y techo 10.
--
-- DETERMINISMO: la selección es por `md5(id)` —estable entre corridas— pero el
-- CUÁNTO depende del día del mes. Dos corridas el mismo día dan el mismo estado;
-- una corrida el 5 y otra el 20 del mismo mes, no. Es la misma clase de
-- dependencia que ya tiene el día de hoy con la hora de corrida (ver encabezado):
-- la huella del MES depende de la FECHA de corrida, la del DÍA depende de la HORA.
create temp table seed_altas_mes as
select c.id
from seed_cust c
join seed_biz b on true
where exists (
        select 1 from appointments a
        where a.customer_id = c.id
          and (a.starts_at at time zone b.timezone)::date >= date_trunc('month', b.hoy)::date
      )
order by pg_temp.h(c.id::text || ':alta-mes')
limit (
  select greatest(2, least(10, round((b2.hoy - date_trunc('month', b2.hoy)::date + 1) * 0.3)))::int
  from seed_biz b2
);

-- Su historia anterior al mes se va: por eso su primera visita cae en el mes.
delete from appointments a
using seed_biz b
where a.business_id = b.id
  and a.customer_id in (select id from seed_altas_mes)
  and (a.starts_at at time zone b.timezone)::date < date_trunc('month', b.hoy)::date;

-- ─── 9. Stats de clientes (el trigger solo corre en UPDATE, no en el seed) ────
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
    -- Un alta del mes NACE con su primera visita; para el resto vale el mínimo
    -- de siempre (un cliente no puede ser más nuevo que su primera cita).
    --
    -- El `greatest` con el inicio del mes cierra un borde que se ve al medirlo:
    -- a quien viene por primera vez el DÍA 1, restarle un día lo hace nacer el
    -- último día del mes anterior y deja de contar como alta del mes — el bloque
    -- elegía 5 y el héroe mostraba 4. Nacer el primer día del mes sigue siendo
    -- ≤ su primera cita, que es la única invariante que importa acá.
    created_at   = case when c.id in (select id from seed_altas_mes)
                        then greatest(g.primera - interval '1 day',
                                      date_trunc('month', g.primera))
                        else least(c.created_at, g.primera - interval '1 day') end
from agg g where c.id = g.customer_id;

-- Clientes del negocio sin ninguna cita tras la purga → stats en cero coherentes.
update customers c
set visit_count = 0, last_visit = null, noshow_count = 0, is_flagged = false
where c.business_id = (select id from seed_biz)
  and not exists (select 1 from appointments a where a.customer_id = c.id);

-- ─── 10. Limpieza del audit "Acción sin identificar" ──────────────────────────
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
    where a.starts_at >= (b.hoy + 1)::timestamp at time zone b.timezone)                                       as futuras,
  (select count(*) from caja_movimientos m join seed_biz b on m.business_id = b.id)                            as movimientos,
  (select count(*) from caja_cortes c join seed_biz b on c.business_id = b.id)                                 as cortes,
  -- Días hábiles de la ventana de cortes SIN corte (incluye el de hoy, a propósito).
  (select count(*) from seed_biz b
   cross join generate_series(b.hoy - 27, b.hoy, interval '1 day') dd(d)
   where extract(dow from dd.d)::int <> 0
     and not exists (select 1 from caja_cortes c
                      where c.business_id = b.id and c.corte_date = dd.d::date))                               as dias_sin_corte,
  -- Suma de descuadres CON SIGNO: si diera 0 exacto, el ruido no sería mixto.
  (select coalesce(sum(c.cash_diff + c.card_diff), 0) from caja_cortes c
     join seed_biz b on c.business_id = b.id)                                                                  as suma_descuadres,
  -- El "+N este mes" del héroe de Clientela (8b). En 0 el crecimiento se ve muerto.
  (select count(*) from customers c join seed_biz b on c.business_id = b.id
    where c.created_at >= date_trunc('month', b.hoy))                                                          as altas_del_mes;
