import { ImageResponse } from 'next/og';
import { clientConfig } from '@/config/client.config';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Deriva iniciales del nombre del primer especialista.
// Ej: "Dra. Jaasiel Quevedo" → "JQ"
function getInitials(name: string): string {
  return name
    .replace(/^(Dr\.|Dra\.)\s*/i, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Favicon generado en build time — iniciales sobre fondo del color primario del cliente.
export default function Icon() {
  const { primary, white } = clientConfig.design.colors;
  const initials = getInitials(clientConfig.specialists[0]?.name ?? clientConfig.client.name);

  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: primary,
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: white,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            fontFamily: 'Georgia, serif',
          }}
        >
          {initials}
        </span>
      </div>
    ),
    { ...size },
  );
}
