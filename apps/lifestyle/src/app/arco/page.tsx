import type { Metadata } from 'next';
import ArcoForm from './ArcoForm';

export const metadata: Metadata = {
  title: 'Derechos ARCO — Zentriq',
  description:
    'Ejerce tus derechos de Acceso, Rectificación, Cancelación u Oposición sobre tus datos personales conforme a la LFPDPPP.',
  robots: { index: true, follow: true },
};

export default function ArcoPage() {
  return (
    <main className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-medium tracking-widest text-neutral-400 uppercase mb-2">
            Zentriq · Privacidad
          </p>
          <h1 className="text-2xl font-semibold text-neutral-900 mb-3">
            Derechos ARCO
          </h1>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Conforme a la{' '}
            <span className="font-medium text-neutral-800">
              Ley Federal de Protección de Datos Personales en Posesión de los
              Particulares (LFPDPPP)
            </span>
            , tienes derecho a:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-neutral-600">
            <li className="flex gap-2">
              <span className="font-semibold text-neutral-800 w-24 shrink-0">Acceso</span>
              <span>Conocer qué datos personales tenemos sobre ti.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-neutral-800 w-24 shrink-0">Rectificación</span>
              <span>Corregir datos inexactos o incompletos.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-neutral-800 w-24 shrink-0">Cancelación</span>
              <span>Solicitar la eliminación de tus datos.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-neutral-800 w-24 shrink-0">Oposición</span>
              <span>Oponerte al tratamiento de tus datos para fines específicos.</span>
            </li>
          </ul>
          <p className="mt-4 text-sm text-neutral-500">
            Tu solicitud será atendida en un plazo máximo de{' '}
            <span className="font-medium text-neutral-700">20 días hábiles</span> conforme
            al artículo 24 de la LFPDPPP.
          </p>
        </div>

        {/* Form */}
        <ArcoForm />

        {/* Footer */}
        <p className="mt-8 text-xs text-neutral-400 text-center">
          También puedes escribirnos directamente a{' '}
          <a
            href="mailto:contacto@zentriq.mx"
            className="text-neutral-600 hover:underline"
          >
            contacto@zentriq.mx
          </a>
        </p>
      </div>
    </main>
  );
}
