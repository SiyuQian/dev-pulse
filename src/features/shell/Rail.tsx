import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

/**
 * Persistent labelled rail. The old three-letter codes (BRD/REV/PPL/TRD) were
 * unreadable cold, so each view now carries an icon plus its real name. Labels
 * collapse back to icons on narrow viewports, where horizontal space is scarcer
 * than legibility.
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...S}>
      {children}
    </svg>
  )
}

const NAV = [
  {
    to: '/',
    label: 'Pipeline',
    icon: (
      <Icon>
        <rect x="1.8" y="2.5" width="3.2" height="11" rx="1" />
        <rect x="6.4" y="2.5" width="3.2" height="7.5" rx="1" />
        <rect x="11" y="2.5" width="3.2" height="9.5" rx="1" />
      </Icon>
    ),
  },
  {
    to: '/mine',
    label: 'Mine',
    icon: (
      <Icon>
        <circle cx="8" cy="5.2" r="2.6" />
        <path d="M2.8 13.6c0-2.7 2.3-4.5 5.2-4.5s5.2 1.8 5.2 4.5" />
      </Icon>
    ),
  },
  {
    to: '/reviews',
    label: 'Reviews',
    icon: (
      <Icon>
        <path d="M1.4 8s2.4-4.4 6.6-4.4S14.6 8 14.6 8s-2.4 4.4-6.6 4.4S1.4 8 1.4 8Z" />
        <circle cx="8" cy="8" r="1.9" />
      </Icon>
    ),
  },
  {
    to: '/people',
    label: 'People',
    icon: (
      <Icon>
        <circle cx="6" cy="5.4" r="2.5" />
        <path d="M1.6 13.8c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4" />
        <path d="M11.1 3.3a2.5 2.5 0 0 1 0 4.6M12.3 9.9c1.4.5 2.3 1.9 2.3 3.9" />
      </Icon>
    ),
  },
  {
    to: '/stats',
    label: 'Trends',
    icon: (
      <Icon>
        <path d="M1.6 12.4l4-4.6 3 2.5 5.8-6.6" />
        <path d="M10.9 3.4h3.5v3.4" />
      </Icon>
    ),
  },
]

function NavItem({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <NavLink to={to} end={to === '/'} title={label}>
      {icon}
      <span className="rail-label">{label}</span>
    </NavLink>
  )
}

export function Rail() {
  return (
    <div className="rail">
      <h1 className="rail-brand">
        <span className="mark" aria-hidden="true" />
        <span className="rail-word">
          <b>dev</b>·pulse
        </span>
      </h1>
      <nav className="rail-nav" aria-label="Views">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
        <NavLink to="/settings" title="Settings" className="rail-settings">
          <Icon>
            <path d="M2.5 4.6h11M2.5 11.4h11" />
            <circle cx="5.8" cy="4.6" r="1.9" fill="var(--panel)" />
            <circle cx="10.2" cy="11.4" r="1.9" fill="var(--panel)" />
          </Icon>
          <span className="rail-label">Settings</span>
        </NavLink>
      </nav>
    </div>
  )
}
