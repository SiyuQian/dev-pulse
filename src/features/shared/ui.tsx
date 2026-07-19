import type { CSSProperties, ReactNode } from 'react'
import { avatarHue } from './format'

export function Avatar({ login }: { login: string }) {
  return (
    <span className="avatar" style={{ background: avatarHue(login) }} aria-hidden="true">
      {login.slice(0, 2).toUpperCase()}
    </span>
  )
}

/**
 * A grouped panel. `note` carries the derived number that makes the group
 * actionable (oldest wait, median cycle) — not a restatement of the count.
 */
export function Panel({
  title, hue, count, note, children,
}: {
  title: string
  hue: string
  count?: number
  note?: string
  children: ReactNode
}) {
  return (
    <section className="panel" style={{ '--hue': hue } as CSSProperties}>
      <div className="panel-head">
        <span className="dot" />
        <h3>{title}</h3>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {note && <p className="panel-note">{note}</p>}
      {children}
    </section>
  )
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
          <span className="queue-sub">{repo.split('/')[1] ?? repo} #{number} · {author}</span>
        </span>
        <span className={`queue-meta${tone ? ` ${tone}` : ''}`}>{meta}</span>
      </a>
    </li>
  )
}

export function Queue({ children, empty }: { children: ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children]
  if (items.length === 0) return <p className="panel-empty">{empty}</p>
  return <ul className="queue">{children}</ul>
}
