import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../state/AppState'
import { useViewer, useViewerRepos } from '../../api/queries'
import { decodeShareFragment, encodeShareFragment, isLogin, isRepoRef } from '../../storage/config'
import { Cell } from '../shared/ui'

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
    <Cell title={label} count={items.length}>
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
    </Cell>
  )
}

function RepoMultiSelect({
  items, onChange, options, loading, backfilling, error, disabled,
}: {
  items: string[]
  onChange: (items: string[]) => void
  options: string[]
  loading: boolean
  /** More pages still arriving — the list is usable but not yet complete. */
  backfilling: boolean
  error: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [invalid, setInvalid] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const selected = new Set(items)
  const q = query.trim().toLowerCase()
  const filtered = options.filter((o) => o.toLowerCase().includes(q))
  const exactInOptions = options.some((o) => o.toLowerCase() === q)
  const canAddManual = q.length > 0 && !exactInOptions

  function toggle(repo: string) {
    onChange(selected.has(repo) ? items.filter((i) => i !== repo) : [...items, repo])
  }

  function addManual() {
    const value = query.trim()
    if (!value) return
    if (!isRepoRef(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (!selected.has(value)) onChange([...items, value])
    setQuery('')
  }

  return (
    <Cell title="Watched repositories" count={items.length}>
      <div className="ms" ref={rootRef}>
        <button
          type="button"
          className="ms-control"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="ms-control-label">
            {disabled
              ? 'Save a token to pick from your repositories'
              : items.length > 0
                ? `${items.length} selected`
                : 'Select repositories…'}
          </span>
          <span className="ms-caret" aria-hidden="true">▾</span>
        </button>

        {open && !disabled && (
          <div className="ms-menu" role="listbox" aria-multiselectable="true">
            <input
              className="ms-search"
              autoFocus
              value={query}
              placeholder="Search or type owner/name…"
              onChange={(e) => { setQuery(e.target.value); setInvalid(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAddManual) { e.preventDefault(); addManual() } }}
              aria-label="Search repositories"
            />
            <div className="ms-options">
              {loading && <p className="ms-status">Loading your repositories…</p>}
              {error && <p className="ms-status error">Couldn’t load repositories — type owner/name to add manually.</p>}
              {!loading && !error && filtered.length === 0 && !canAddManual && (
                <p className="ms-status">
                  {backfilling ? 'Still loading more repositories…' : 'No matching repositories.'}
                </p>
              )}
              {filtered.map((repo) => (
                <label key={repo} className="ms-option" role="option" aria-selected={selected.has(repo)}>
                  <input type="checkbox" checked={selected.has(repo)} onChange={() => toggle(repo)} />
                  <span>{repo}</span>
                </label>
              ))}
              {canAddManual && (
                <button type="button" className="ms-add" onClick={addManual}>
                  {isRepoRef(query.trim()) ? `Add “${query.trim()}”` : 'Add… (expects owner/name)'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {invalid
        ? <p className="field-error">Invalid format — expected owner/name, e.g. vercel/next.js</p>
        : <p className="field-hint">Pick from repositories your token can see, or type any owner/name.</p>}
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
    </Cell>
  )
}

export function SettingsPage() {
  const { token, setToken, config, setConfig } = useAppState()
  const [tokenDraft, setTokenDraft] = useState(token)
  const [copied, setCopied] = useState(false)
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof decodeShareFragment>>(null)
  const viewer = useViewer(token)
  const viewerRepos = useViewerRepos(token)
  const navigate = useNavigate()

  const repoOptions = viewerRepos.repos
    .filter((r) => !r.isArchived)
    .map((r) => r.nameWithOwner)

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

      <Cell title="GitHub token">
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
      </Cell>

      <RepoMultiSelect
        items={config.repos}
        onChange={(repos) => setConfig({ ...config, repos })}
        options={repoOptions}
        loading={viewerRepos.isLoading}
        backfilling={viewerRepos.isBackfilling}
        error={Boolean(viewerRepos.error)}
        disabled={!token}
      />

      <ListEditor
        label="Watched people"
        placeholder="github-login"
        items={config.users}
        validate={isLogin}
        onChange={(users) => setConfig({ ...config, users })}
        hint="GitHub username, e.g. octocat"
      />

      <Cell title="Stale threshold">
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
      </Cell>

      <Cell title="Share config">
        <p className="field-hint">
          Copies a link containing your watchlist (repos, people, stale threshold). Your token is never included.
        </p>
        <button onClick={copyShareLink}>{copied ? 'Copied ✓' : 'Copy share link'}</button>
      </Cell>
    </div>
  )
}
