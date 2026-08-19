// ─── /aviso-de-privacidad — el aviso deja de ser 404 (S8-PER-01 · P0) ────────
// Server Component estático. Cuatro enlaces vivos del producto apuntaban acá y
// los cuatro daban 404: el footer del mini-sitio público, el del dashboard, el
// del Home y —el peor— el del formulario con el que un titular ejerce sus
// derechos ARCO. Más el link que el bot le manda por WhatsApp a cada cliente
// nuevo.
//
// El aviso es GENÉRICO de la plataforma y no por negocio, y eso es a propósito:
// la estructura legal es la misma para todos —cada barbería es responsable de
// los datos de SUS clientes, Zentriq opera la plataforma como encargado— y una
// versión por negocio significaría un texto legal que nadie revisa multiplicado
// por cada alta.
//
// Fecha de versión visible: un aviso sin fecha no se puede auditar ni comparar
// con el consentimiento que un titular otorgó (`customers.consent_at`).
//
// ⚠️ Dependencia manual anotada en el plan: la revisión de abogado. Se publica
//    la v1 fechada; la revisión ajusta, no estrena.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Aviso de Privacidad — Zentriq',
  description:
    'Aviso de privacidad de la plataforma presenciapro, operada por Zentriq, conforme a la LFPDPPP.',
  robots: { index: true, follow: true },
};

/** Fecha de la versión vigente. Se actualiza SOLO cuando cambia el texto. */
const VERSION = '18 de agosto de 2026';

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-neutral-900">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-neutral-600">{children}</div>
    </section>
  );
}

export default function AvisoDePrivacidadPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-neutral-400">
          Zentriq · Privacidad
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900">Aviso de Privacidad</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Versión vigente: <span className="font-medium text-neutral-700">{VERSION}</span>
        </p>

        <Seccion titulo="Quién trata tus datos">
          <p>
            <strong className="font-medium text-neutral-800">La barbería o salón que te atiende</strong> es
            el responsable de tus datos personales: es quien decide para qué los usa y quien
            los recabó al agendarte una cita.
          </p>
          <p>
            <strong className="font-medium text-neutral-800">Zentriq</strong> (contacto@zentriq.mx) opera
            la plataforma <em>presenciapro</em> como <strong className="font-medium text-neutral-800">encargado</strong>:
            almacena y procesa esos datos por cuenta del negocio, siguiendo sus instrucciones, y
            no los usa para fines propios.
          </p>
        </Seccion>

        <Seccion titulo="Qué datos se recaban">
          <p>
            Tu nombre y tu número de WhatsApp; el historial de tus citas (servicio, barbero,
            fecha y monto cobrado); y las notas operativas que el negocio agregue sobre tu
            atención. Si escribes al asistente de WhatsApp, también el contenido de esa
            conversación.
          </p>
          <p className="text-neutral-500">
            No se recaban datos personales sensibles, ni datos financieros o patrimoniales:
            los cobros se registran como monto y forma de pago, nunca como datos de tu tarjeta.
          </p>
        </Seccion>

        <Seccion titulo="Para qué se usan">
          <p>
            <strong className="font-medium text-neutral-800">Finalidad primaria</strong> — las que
            hacen falta para darte el servicio: agendar, confirmar y recordarte tus citas,
            atenderte el día de la cita y llevar el registro de tu historial con el negocio.
          </p>
          <p>
            <strong className="font-medium text-neutral-800">Finalidad secundaria</strong> — mensajes
            de la barbería que no son necesarios para atenderte: recordarte que hace tiempo no
            vienes, invitarte a dejar una reseña o contarte de una promoción.
          </p>
          <p>
            <strong className="font-medium text-neutral-800">Puedes rechazar las secundarias sin
            perder el servicio.</strong> Escribe <strong className="font-medium text-neutral-800">BAJA</strong>{' '}
            por WhatsApp al número del negocio y dejarás de recibir esos mensajes. Seguirás
            recibiendo los recordatorios de las citas que tú agendes, porque son parte del
            servicio que pediste.
          </p>
        </Seccion>

        <Seccion titulo="Con quién se comparten">
          <p>
            Con nadie más que el negocio que te atiende y los proveedores de infraestructura
            que la plataforma necesita para funcionar (alojamiento de la base de datos y
            mensajería de WhatsApp), que actúan también como encargados. No se venden ni se
            comparten con terceros para fines de mercadotecnia.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos ARCO">
          <p>
            Puedes <strong className="font-medium text-neutral-800">Acceder</strong> a tus datos,{' '}
            <strong className="font-medium text-neutral-800">Rectificarlos</strong> si son inexactos,
            solicitar su <strong className="font-medium text-neutral-800">Cancelación</strong> u{' '}
            <strong className="font-medium text-neutral-800">Oponerte</strong> a que se usen para
            fines específicos, conforme a los artículos 22 a 25 de la LFPDPPP.
          </p>
          <p>
            Presenta tu solicitud en{' '}
            <Link href="/arco" className="font-medium text-neutral-800 underline">
              el formulario de derechos ARCO
            </Link>{' '}
            o escribiendo a{' '}
            <a href="mailto:contacto@zentriq.mx" className="font-medium text-neutral-800 underline">
              contacto@zentriq.mx
            </a>
            . Se atiende en un plazo máximo de{' '}
            <strong className="font-medium text-neutral-800">20 días hábiles</strong> (artículo 24).
          </p>
        </Seccion>

        <Seccion titulo="Cambios a este aviso">
          <p>
            Cualquier cambio se publica en esta misma página con una fecha de versión nueva. Te
            recomendamos revisarla de vez en cuando; los cambios sustanciales se comunican por
            el mismo medio por el que nos escribes.
          </p>
        </Seccion>

        <p className="mt-10 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
          Zentriq · <a href="mailto:contacto@zentriq.mx" className="underline">contacto@zentriq.mx</a>
          {' · '}
          <Link href="/arco" className="underline">Derechos ARCO</Link>
        </p>
      </div>
    </main>
  );
}
