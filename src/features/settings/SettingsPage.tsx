import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../state/AppState'
import { useViewer } from '../../api/queries'
import { decodeShareFragment, encodeShareFragment, isLogin, isRepoRef } from '../../storage/config'
import { Panel } from '../shared/ui'

function ListEditor({
  label, placeholder, items, validate, onChange, hint, hue,
}: {
  label: string
  placeholder: string
  items: string[]
  validate: (v: string) => boolean
  onChange: (items: string[]) => void
  hint: string
  hue: string
}) {
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  function add(e: FormEvent) {
    e.preventDefault()
    const value = draft.trim()
    if (!value) return
    if (!validate(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (!items.includes(value)) onChange([...items, value])
    setDraft('')
  }

  return (
    <Panel title={label} hue={hue} count={items.length}>
      <form onSubmit={add} className="inline-form">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false) }}
          aria-label={label}
        />
        <button type="submit">Add</button>
      </form>
      {invalid ? <p className="field-error">Invalid format — expected {hint}</p> : <p className="field-hint">{hint}</p>}
      {items.length > 0 && (
        <ul className="chip-list">
          {items.map((item) => (
            <li key={item} className="chip">
              {item}
              <button aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function SettingsPage() {
  const { token, setToken, config, setConfig } = useAppState()
  const [tokenDraft, setTokenDraft] = useState(token)
  const [copied, setCopied] = useState(false)
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof decodeShareFragment>>(null)
  const viewer = useViewer(token)
  const navigate = useNavigate()

  useEffect(() => {
    const stashed = sessionStorage.getItem('devpulse:pending-import')
    if (!stashed) return
    const imported = decodeShareFragment(stashed)
    if (imported) setPendingImport(imported)
    else sessionStorage.removeItem('devpulse:pending-import')
  }, [])

  function clearPendingImport() {
    sessionStorage.removeItem('devpulse:pending-import')
    setPendingImport(null)
  }

  async function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}${encodeShareFragment(config)}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const owners = new Set(config.repos.map((repo) => repo.split('/')[0]))

  return (
    <div className="settings">
      <div className="page-head">
        <h2>Settings</h2>
        <p>Your token and watchlist live in this browser only.</p>
      </div>

      {pendingImport && (
        <div className="import-banner">
          <p>
            This link contains a shared watchlist: <strong>{pendingImport.repos.length}</strong> repos,{' '}
            <strong>{pendingImport.users.length}</strong> people. Import it? This replaces your current watchlist
            (your token is not affected).
          </p>
          <button
            onClick={() => {
              setConfig(pendingImport)
              clearPendingImport()
              navigate('/')
            }}
          >
            Import
          </button>
          <button className="secondary" onClick={clearPendingImport}>Dismiss</button>
        </div>
      )}

      <Panel title="GitHub token" hue="var(--attn)">
        <p className="field-hint">
          Fine-grained personal access token, stored only in this browser and sent only to api.github.com.
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => { e.preventDefault(); setToken(tokenDraft.trim()) }}
        >
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder="github_pat_…"
            aria-label="GitHub token"
          />
          <button type="submit">Save</button>
          {token && (
            <button type="button" className="secondary" onClick={() => { setToken(''); setTokenDraft('') }}>
              Clear
            </button>
          )}
        </form>
        {token && viewer.data && <p className="field-ok">✓ Authenticated as {viewer.data}</p>}
        {token && viewer.error && <p className="field-error">Token check failed: {viewer.error.message}</p>}

        <dl className="perms">
          <div><dt>Metadata</dt><dd>Required on every fine-grained token</dd></div>
          <div><dt>Pull requests</dt><dd>PR titles, review decisions, requested reviewers</dd></div>
          <div><dt>Commit statuses</dt><dd>CI badges on the board</dd></div>
          <div><dt>Checks</dt><dd>CI badges for GitHub Actions runs</dd></div>
        </dl>
        <p className="field-hint">All read-only. No write permission is ever used.</p>
        {owners.size > 1 && (
          <p className="field-warn">
            Your watchlist spans {owners.size} owners ({[...owners].join(', ')}). A fine-grained token can only
            reach one owner's repos, and GitHub returns the rest as missing rather than as an error — use a
            classic token with <code>repo</code> scope, or narrow the watchlist.
          </p>
        )}
      </Panel>

      <ListEditor
        label="Watched repositories"
        placeholder="owner/name"
        items={config.repos}
        validate={isRepoRef}
        onChange={(repos) => setConfig({ ...config, repos })}
        hint="owner/name, e.g. vercel/next.js"
        hue="var(--stage-review)"
      />

      <ListEditor
        label="Watched people"
        placeholder="github-login"
        items={config.users}
        validate={isLogin}
        onChange={(users) => setConfig({ ...config, users })}
        hint="GitHub username, e.g. octocat"
        hue="var(--stage-draft)"
      />

      <Panel title="Stale threshold" hue="var(--stage-changes)">
        <label className="inline-form">
          Mark a PR stale after
          <input
            type="number"
            min={1}
            value={config.staleDays}
            onChange={(e) => {
              const days = Number(e.target.value)
              if (Number.isFinite(days) && days > 0) setConfig({ ...config, staleDays: days })
            }}
            style={{ width: '4rem' }}
          />
          days without updates
        </label>
        <p className="field-hint">Drives the idle stripe on board cards and the “Idle only” filter.</p>
      </Panel>

      <Panel title="Share config" hue="var(--stage-approved)">
        <p className="field-hint">
          Copies a link containing your watchlist (repos, people, stale threshold). Your token is never included.
        </p>
        <button onClick={copyShareLink}>{copied ? 'Copied ✓' : 'Copy share link'}</button>
      </Panel>
    </div>
  )
}
