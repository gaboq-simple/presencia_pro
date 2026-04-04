import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Favicon generado en build time — iniciales JQ sobre fondo acento.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: '#8B6F5E',
          borderRadius: 7,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#FAFAF8',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            fontFamily: 'Georgia, serif',
          }}
        >
          JQ
        </span>
      </div>
    ),
    { ...size },
  );
}
