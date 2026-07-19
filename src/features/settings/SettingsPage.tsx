import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../state/AppState'
import { useViewer } from '../../api/queries'
import { decodeShareFragment, encodeShareFragment, isLogin, isRepoRef } from '../../storage/config'

function ListEditor({
  label, placeholder, items, validate, onChange, hint,
}: {
  label: string
  placeholder: string
  items: string[]
  validate: (v: string) => boolean
  onChange: (items: string[]) => void
  hint: string
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
    <section className="setting-block">
      <h3>{label}</h3>
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
      <ul className="chip-list">
        {items.map((item) => (
          <li key={item} className="chip">
            {item}
            <button aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>×</button>
          </li>
        ))}
      </ul>
    </section>
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

  return (
    <div className="settings">
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
          <button
            className="secondary"
            onClick={clearPendingImport}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="setting-block">
        <h3>GitHub token</h3>
        <p className="field-hint">
          Fine-grained personal access token with read access to the repos you watch. Stored only in this
          browser, sent only to api.github.com.
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
      </section>

      <ListEditor
        label="Watched repositories"
        placeholder="owner/name"
        items={config.repos}
        validate={isRepoRef}
        onChange={(repos) => setConfig({ ...config, repos })}
        hint="owner/name, e.g. vercel/next.js"
      />

      <ListEditor
        label="Watched people"
        placeholder="github-login"
        items={config.users}
        validate={isLogin}
        onChange={(users) => setConfig({ ...config, users })}
        hint="GitHub username, e.g. octocat"
      />

      <section className="setting-block">
        <h3>Stale threshold</h3>
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
      </section>

      <section className="setting-block">
        <h3>Share config</h3>
        <p className="field-hint">
          Copies a link containing your watchlist (repos, people, stale threshold). Your token is never included.
        </p>
        <button onClick={copyShareLink}>{copied ? 'Copied ✓' : 'Copy share link'}</button>
      </section>
    </div>
  )
}
