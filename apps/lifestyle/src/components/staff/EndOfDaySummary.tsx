// ─── EndOfDaySummary ──────────────────────────────────────────────────────────
// Resumen de fin de jornada del barbero (maqueta v5).
//
// Visible solo cuando: el día es HOY, hay citas, y ninguna sigue activa
// (todas en estado terminal completed/no_show/cancelled).
//
// Matriz de 3 celdas: Completadas · No-show · "Mañana llevas X" (dato abierto).
// Debajo, una frase IMPERSONAL aleatoria del pool (no habla del barbero) — un
// respiro al final del día, estilo galletita de la fortuna.

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DayAppointmentForStaff } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DayAppointmentForStaff[];
  date: string;      // 'YYYY-MM-DD' visualizado
  staffId: string;   // para contar las citas de mañana (RLS-scoped)
};

// ─── Pool de frases (v5) ──────────────────────────────────────────────────────
// Impersonal por diseño: datos curiosos, chistes de papá, motivacionales reales,
// random. Filtro de tono: nada de religión/política/burla/muerte/inglés.
const FRASES = [
  'Los pulpos tienen tres corazones.',
  'Un día en Venus dura más que un año en Venus.',
  'La miel no caduca: se halló miel comestible de hace 3000 años.',
  'Los flamencos nacen grises; se vuelven rosas por lo que comen.',
  'Las nutrias se toman de las patas al dormir para no separarse.',
  'El corazón de una ballena azul pesa como un auto pequeño.',
  'Saturno flotaría en el agua si hubiera una tina lo bastante grande.',
  'Las abejas pueden reconocer rostros humanos.',
  'Los caracoles pueden dormir hasta tres años seguidos.',
  'La Torre Eiffel crece unos 15 cm en verano por el calor.',
  'Los delfines se ponen apodos entre ellos.',
  'El plástico de burbujas se inventó para ser papel tapiz.',
  '¿Qué hace una abeja en el gimnasio? Zum-ba.',
  '¿Cómo se despiden los químicos? Ácido un placer.',
  '¿Por qué el libro de mates está triste? Tiene muchos problemas.',
  '¿Qué le dijo un semáforo a otro? No me mires, me estoy cambiando.',
  '¿Cómo se llama el campeón japonés de clavados? Tokofondo.',
  '¿Qué hace un pez? Nada.',
  '¿Cuál es el café más peligroso? El exprés.',
  '¿Qué le dice un cero a un ocho? Bonito cinturón.',
  'El que persevera, alcanza.',
  'Cae siete veces, levántate ocho.',
  'No cuentes los días; haz que los días cuenten.',
  'La paciencia es amarga, pero su fruto es dulce.',
  'Un río corta la roca no por su fuerza, sino por su constancia.',
  'De a poco se llega lejos.',
  'El nombre del símbolo # es "octothorpe".',
  'Bostezar es contagioso: hasta leerlo puede provocarlo.',
  'Los gatos no perciben el sabor dulce.',
  'Un grupo de flamencos se llama "flamboyance".',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'no_show', 'cancelled']);
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'walkin']);

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Celda de la matriz ───────────────────────────────────────────────────────

function Cell({
  value,
  label,
  tone,
  hint,
}: {
  value: number | string;
  label: string;
  tone: 'ink' | 'red' | 'teal';
  hint?: string;
}) {
  const valueColor =
    tone === 'red' ? 'text-red-ink' : tone === 'teal' ? 'text-teal-ink' : 'text-ink';
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <span className={`text-[26px] font-semibold tabular-nums leading-none ${valueColor}`}>
        {value}
      </span>
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {hint && <span className="text-[10px] font-semibold text-teal-ink">{hint}</span>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EndOfDaySummary({ appointments, date, staffId }: Props) {
  const [tomorrowCount, setTomorrowCount] = useState<number | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);

  // Frase aleatoria — client-only para evitar hydration mismatch.
  useEffect(() => {
    setPhrase(FRASES[Math.floor(Math.random() * FRASES.length)] ?? null);
  }, []);

  // Citas de mañana (dato abierto "y subiendo") — RLS garantiza solo las propias.
  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    const tomorrow = addDays(date, 1);
    (async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('staff_id', staffId)
        .neq('status', 'cancelled')
        .gte('starts_at', `${tomorrow}T00:00:00`)
        .lte('starts_at', `${tomorrow}T23:59:59`);
      if (!cancelled) setTomorrowCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [staffId, date]);

  // ── Gating ──────────────────────────────────────────────────────────────────
  if (!isToday(date)) return null;
  if (appointments.length === 0) return null;
  if (appointments.some((a) => ACTIVE_STATUSES.has(a.status))) return null;
  if (!appointments.every((a) => TERMINAL_STATUSES.has(a.status))) return null;

  const completedCount = appointments.filter((a) => a.status === 'completed').length;
  const noShowCount = appointments.filter((a) => a.status === 'no_show').length;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      {/* Encabezado */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-semibold text-ink">Fin de jornada</span>
        <span className="rounded-pill bg-tint-1 px-2 py-0.5 text-[10.5px] font-semibold text-teal-ink">
          Hoy
        </span>
      </div>

      {/* Matriz 3 celdas */}
      <div className="flex items-stretch px-4 py-4">
        <Cell value={completedCount} label="Completadas" tone="ink" />
        <span className="mx-2 w-px self-stretch bg-line" aria-hidden="true" />
        <Cell value={noShowCount} label="No-show" tone={noShowCount > 0 ? 'red' : 'ink'} />
        <span className="mx-2 w-px self-stretch bg-line" aria-hidden="true" />
        <Cell
          value={tomorrowCount ?? '·'}
          label="Mañana llevas"
          tone="teal"
          hint={tomorrowCount && tomorrowCount > 0 ? 'y subiendo ↑' : undefined}
        />
      </div>

      {/* Frase impersonal del pool */}
      {phrase && (
        <div className="border-t border-line bg-tint-1 px-4 py-3">
          <p className="text-center text-[13px] leading-snug text-ink-2">{phrase}</p>
        </div>
      )}
    </div>
  );
}
