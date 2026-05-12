// ─── Team Section ─────────────────────────────────────────────────────────────
// Horizontal scroll con snap en mobile, grid en desktop.
// Avatar con forma orgánica Mid-Century (border-radius asimétrico).
// Foto: next/image si photo_url existe; fallback de iniciales.
// Server Component.

import Image from 'next/image';
import type { SiteStaffRow, SitePalette } from '@/lib/dashboard.types';
import { RevealObserver } from './RevealObserver';

type TeamSectionProps = {
  staffMembers: SiteStaffRow[];
  palette: SitePalette;
};

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    barber: 'Barbero',
    assistant: 'Asistente',
    admin: 'Encargado',
  };
  return map[role] ?? role;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

export function TeamSection({ staffMembers, palette: _palette }: TeamSectionProps) {
  if (staffMembers.length === 0) return null;

  return (
    <section id="equipo" className="site-section">
      <RevealObserver />

      <div className="reveal">
        <p className="site-section-label">Nuestro equipo</p>
        <h2 className="site-section-title">Los expertos</h2>
      </div>

      {/* Horizontal scroll en mobile, grid en desktop */}
      <div className="team-track-wrapper reveal reveal-delay-1">
        <ul className="team-track" style={{ listStyle: 'none' }}>
          {staffMembers.map((member) => (
            <li key={member.id} className="team-card">
              {/* Avatar con forma orgánica */}
              <div className="team-avatar">
                {member.photo_url ? (
                  <Image
                    src={member.photo_url}
                    alt={member.name}
                    width={300}
                    height={400}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'top center',
                    }}
                  />
                ) : (
                  <div className="team-avatar__initials" aria-hidden>
                    {getInitials(member.name)}
                  </div>
                )}
              </div>

              <div>
                <p className="team-card__name">{member.name}</p>
                <p className="team-card__role">{getRoleLabel(member.role)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
