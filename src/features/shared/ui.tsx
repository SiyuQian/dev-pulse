import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { avatarHue, formatCompact, formatDays } from './format'

/**
 * Real GitHub avatar, keyed off the login so it works for reviewers too (we only
 * ever have their login). Falls back to the coloured initials tile for logins
 * with no image — deleted accounts, `ghost`, or a blocked image request.
 */
export function Avatar({ login, title }: { login: string; title?: string }) {
  const [failed, setFailed] = useState(false)
  const hue = avatarHue(login)
  if (failed || login === 'ghost') {
    return (
      <span className="avatar" style={{ background: hue }} title={title ?? login} aria-hidden="true">
        {login.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="avatar"
      style={{ background: hue }}
      src={`https://github.com/${encodeURIComponent(login)}.png?size=48`}
      srcSet={`https://github.com/${encodeURIComponent(login)}.png?size=96 2x`}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      title={title ?? login}
      onError={() => setFailed(true)}
    />
  )
}

/** Overlapping avatar stack for requested reviewers. */
export function AvatarRow({ logins, empty = '—' }: { logins: string[]; empty?: string }) {
  if (logins.length === 0) return <span className="mono-dim">{empty}</span>
  const shown = logins.slice(0, 4)
  return (
    <span className="avatar-row">
      {shown.map((login) => (
        <Avatar key={login} login={login} />
      ))}
      {logins.length > shown.length && <span className="avatar-more">+{logins.length - shown.length}</span>}
    </span>
  )
}

/**
 * Idle time as a bar plus a number. The bar is the point: a full, red track
 * reads as "rotting" without the eye having to parse "6.4d" first.
 */
export function AgeBar({ days, staleDays }: { days: number; staleDays: number }) {
  const ratio = Math.min(1, days / staleDays)
  const tone = ratio >= 1 ? ' crit' : ratio >= 0.6 ? ' hot' : ''
  return (
    <span className={`age${tone}`}>
      <span className="age-track">
        <i style={{ width: `${Math.max(3, ratio * 100)}%` }} />
      </span>
      <b>{formatDays(days)}</b>
    </span>
  )
}

export function Diff({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff">
      <span className="add">+{formatCompact(additions)}</span> <span className="del">−{formatCompact(deletions)}</span>
    </span>
  )
}

const CI_TONE: Record<string, { tone: string; label: string }> = {
  SUCCESS: { tone: 'ok', label: 'pass' },
  FAILURE: { tone: 'bad', label: 'fail' },
  ERROR: { tone: 'bad', label: 'error' },
  PENDING: { tone: 'warn', label: 'run' },
  EXPECTED: { tone: 'warn', label: 'queued' },
}

export function CiDot({ status }: { status: string | null }) {
  const ci = status ? CI_TONE[status] : undefined
  if (!ci) return <span className="mono-dim">—</span>
  return (
    <span className={`ci ${ci.tone}`}>
      <i className="dot" />
      {ci.label}
    </span>
  )
}

export function Tag({ kind, children }: { kind: 'you' | 'idle' | 'ci' | 'ready'; children: ReactNode }) {
  return <span className={`tag ${kind}`}>{children}</span>
}

/** Section header: title, a derived sub-number, and optional right-side controls. */
export function SectionHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2>{title}</h2>
      {sub && <span className="sub">{sub}</span>}
      {children && <div className="sec-actions">{children}</div>}
    </div>
  )
}

/** Segmented control. Values are compared by identity, so any union works. */
export function Seg<T extends string | number>({
  value, options, onChange, label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Hairline grid of cells — the Console's only container. No nested cards. */
export function Grid({ cols, children }: { cols: 2 | 3 | 4; children: ReactNode }) {
  return <div className={`grid c${cols}`}>{children}</div>
}

export function Cell({
  title, note, count, wide, children,
}: {
  title: string
  note?: string
  count?: number
  /** Span the full grid width — used by Settings for the long forms. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section className={`cell${wide ? ' wide' : ''}`}>
      <h3>
        {title}
        {count !== undefined && <span className="cell-count">{count}</span>}
      </h3>
      {note && <p className="cell-note">{note}</p>}
      {children}
    </section>
  )
}

/**
 * A headline number. `delta` is the whole reason this exists — a bare "27h"
 * tells you nothing without a baseline to compare against.
 */
export function Stat({
  value, unit, delta, tone = 'flat', mine,
}: {
  value: ReactNode
  unit?: string
  delta?: string
  tone?: 'up' | 'down' | 'flat'
  mine?: boolean
}) {
  return (
    <div className={`stat${mine ? ' mine' : ''}`}>
      <span className="v">{value}</span>
      {unit && <span className="u">{unit}</span>}
      {delta && <span className={`delta ${tone}`}>{delta}</span>}
    </div>
  )
}

/** Vertical bars with value labels above and period labels below. */
export function Bars({ series, highlightLast = true }: { series: { label: string; value: number }[]; highlightLast?: boolean }) {
  const max = Math.max(1, ...series.map((s) => s.value))
  return (
    <>
      <div
        className={`cols${highlightLast ? ' hl-last' : ''}`}
        role="img"
        aria-label={series.map((s) => `${s.label}: ${s.value}`).join(', ')}
      >
        {series.map((s) => (
          <span className="col" key={s.label}>
            <b>{s.value}</b>
            <i style={{ height: `${Math.max(2, (s.value / max) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="axis">
        {series.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </div>
    </>
  )
}

/** Ranked list with a proportional track — reviews given, merges per author. */
export function LoadList({ children }: { children: ReactNode }) {
  return <ul className="load">{children}</ul>
}

export function LoadRow({
  login, sub, value, ratio, hue, isViewer,
}: {
  login: string
  sub?: ReactNode
  value: ReactNode
  ratio: number
  hue: string
  isViewer?: boolean
}) {
  return (
    <li className={isViewer ? 'is-you' : undefined}>
      <Avatar login={login} />
      <div className="load-main">
        <div className="load-name">
          {login}
          {isViewer && <em>you</em>}
          {sub && <span className="load-sub">{sub}</span>}
        </div>
        <div className="load-track">
          <i style={{ width: `${Math.max(2, ratio * 100)}%`, background: hue } as CSSProperties} />
        </div>
      </div>
      <span className="load-value">{value}</span>
    </li>
  )
}

export function Queue({ children, empty }: { children: ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children]
  if (items.length === 0) return <p className="cell-empty">{empty}</p>
  return <ul className="queue">{children}</ul>
}

export function QueueRow({
  url, repo, number, title, author, meta, tone,
}: {
  url: string
  repo: string
  number: number
  title: string
  author: string
  meta: string
  tone?: 'warn' | 'bad'
}) {
  return (
    <li>
      <a className="queue-row" href={url} target="_blank" rel="noreferrer">
        <Avatar login={author} />
        <span className="queue-main">
          <span className="queue-title">{title}</span>
          <span className="queue-sub">
            {repo.split('/')[1] ?? repo} #{number} · {author}
          </span>
        </span>
        <span className={`queue-meta${tone ? ` ${tone}` : ''}`}>{meta}</span>
      </a>
    </li>
  )
}

export function Empty({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={`empty${error ? ' error' : ''}`}>{children}</p>
}
