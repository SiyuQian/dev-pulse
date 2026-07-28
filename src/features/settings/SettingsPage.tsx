import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState, type Account } from '../../state/AppState'
import { useOrgMembers, useViewer, useViewerRepos } from '../../api/queries'
import type { OrgMember, SkippedOrg } from '../../api/github'
import {
  decodeShareFragment,
  encodeShareFragment,
  isLogin,
  isRepoRef,
  profileName,
} from '../../storage/config'
import { AccountFace, Avatar, Cell } from '../shared/ui'
import { scopeSummary } from '../shared/format'

/**
 * Both pickers are plain absolutely-positioned menus, so both need this.
 * Takes the `useState` setter rather than a closure: it's referentially stable,
 * so the listener is bound once per open rather than on every keystroke.
 */
function useCloseOnOutsideClick(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, setOpen])
  return rootRef
}

/** The selected-logins chip row shared by both pickers. */
function SelectionChips({ items, onChange }: { items: string[]; onChange: (i: string[]) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="chip-list">
      {items.map((item) => (
        <li key={item} className="chip">
          {item}
          <button
            aria-label={`Remove ${item}`}
            onClick={() => onChange(items.filter((i) => i !== item))}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

function RepoMultiSelect({
  items,
  onChange,
  options,
  loading,
  backfilling,
  error,
  disabled,
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
  const rootRef = useCloseOnOutsideClick(open, setOpen)

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
          <span className="ms-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && !disabled && (
          <div className="ms-menu" role="listbox" aria-multiselectable="true">
            <input
              className="ms-search"
              autoFocus
              value={query}
              placeholder="Search or type owner/name…"
              onChange={(e) => {
                setQuery(e.target.value)
                setInvalid(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canAddManual) {
                  e.preventDefault()
                  addManual()
                }
              }}
              aria-label="Search repositories"
            />
            <div className="ms-options">
              {loading && <p className="ms-status">Loading your repositories…</p>}
              {error && (
                <p className="ms-status error">
                  Couldn’t load repositories — type owner/name to add manually.
                </p>
              )}
              {!loading && !error && options.length === 0 && !canAddManual && (
                <p className="ms-status">
                  {backfilling
                    ? 'Still loading more repositories…'
                    : // Distinct from "no match": the token sees nothing at all, which
                      // is a permissions problem no amount of searching will fix.
                      'This token can’t see any repositories. A fine-grained PAT only reaches the owner that created it — check the resource owner, and that Metadata is read-only enabled. Or type owner/name to add one directly.'}
                </p>
              )}
              {!loading &&
                !error &&
                options.length > 0 &&
                filtered.length === 0 &&
                !canAddManual && (
                  <p className="ms-status">
                    {backfilling ? 'Still loading more repositories…' : 'No matching repositories.'}
                  </p>
                )}
              {filtered.map((repo) => (
                <label
                  key={repo}
                  className="ms-option"
                  role="option"
                  aria-selected={selected.has(repo)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(repo)}
                    onChange={() => toggle(repo)}
                  />
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
      {invalid ? (
        <p className="field-error">Invalid format — expected owner/name, e.g. vercel/next.js</p>
      ) : (
        <p className="field-hint">
          Pick from repositories your token can see, or type any owner/name.
        </p>
      )}
      <SelectionChips items={items} onChange={onChange} />
    </Cell>
  )
}

/**
 * Why the people list came back empty. Worth spelling out rather than showing
 * one generic line: GitHub answers "an org this token can't see" with HTTP 200
 * and a NOT_FOUND error, so an unauthorised token is indistinguishable from an
 * empty org unless the reason is carried all the way here. Each case below has a
 * different fix, and guessing between them is exactly what wastes the time.
 */
function PeopleDiagnosis({
  error,
  skipped,
  orgCount,
}: {
  error: Error | null
  skipped: SkippedOrg[]
  orgCount: number
}) {
  if (error) {
    return (
      <p className="ms-status error">
        Couldn’t load your organisation: {error.message}. Type a login to add anyone.
      </p>
    )
  }
  if (orgCount === 0) {
    return (
      <p className="ms-status">
        This token reports no organisations. A fine-grained PAT only sees the organisation that
        <em> owns</em> it — recreate it with your org as the resource owner, and grant it the
        read-only <strong>Members</strong> organisation permission. A classic token needs{' '}
        <code>read:org</code> and, if your org enforces SAML SSO, must be authorised for it. Until
        then, type a login to add anyone.
      </p>
    )
  }
  if (skipped.length > 0) {
    return (
      <p className="ms-status">
        Couldn’t read members of {skipped.map((s) => s.org).join(', ')} — GitHub said “
        {skipped[0].reason}”. That usually means the token is missing the read-only{' '}
        <strong>Members</strong> organisation permission, or hasn’t been authorised for the org’s
        SAML SSO. Type a login to add anyone.
      </p>
    )
  }
  return (
    <p className="ms-status">
      Your {orgCount === 1 ? 'organisation reports' : 'organisations report'} no members. Type a
      login to add anyone.
    </p>
  )
}

/**
 * People picker. When the account belongs to orgs, it lists your actual
 * colleagues — nobody remembers a teammate's GitHub login, and typing one
 * wrong silently produces an empty board. Typing a login by hand stays
 * available for outside collaborators, and is the whole picker for a token
 * that can't read org membership.
 */
function PeopleMultiSelect({
  items,
  onChange,
  members,
  loading,
  backfilling,
  disabled,
  error,
  skipped,
  tokenOrgCount,
  truncated,
}: {
  items: string[]
  onChange: (items: string[]) => void
  members: OrgMember[]
  loading: boolean
  /** More pages still arriving — the list is usable but not yet complete. */
  backfilling: boolean
  disabled: boolean
  error: Error | null
  /** Orgs whose member list the token couldn't read, with GitHub's reason. */
  skipped: SkippedOrg[]
  /** Orgs the *token* reports, readable or not — distinct from those with members. */
  tokenOrgCount: number
  truncated: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [invalid, setInvalid] = useState(false)
  const rootRef = useCloseOnOutsideClick(open, setOpen)

  const selected = new Set(items)
  const q = query.trim().toLowerCase()
  const filtered = members.filter(
    (m) => m.login.toLowerCase().includes(q) || (m.name?.toLowerCase().includes(q) ?? false),
  )
  const exactMatch = members.some((m) => m.login.toLowerCase() === q)
  const canAddManual = q.length > 0 && !exactMatch

  // Only worth grouping when the account spans more than one org.
  const groups = useMemo(() => {
    const byOrg = new Map<string, OrgMember[]>()
    for (const member of filtered) {
      const list = byOrg.get(member.org)
      if (list) list.push(member)
      else byOrg.set(member.org, [member])
    }
    return [...byOrg.entries()]
  }, [filtered])
  const orgCount = new Set(members.map((m) => m.org)).size

  function toggle(login: string) {
    onChange(selected.has(login) ? items.filter((i) => i !== login) : [...items, login])
  }

  function addManual() {
    const value = query.trim()
    if (!value) return
    if (!isLogin(value)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (!selected.has(value)) onChange([...items, value])
    setQuery('')
  }

  return (
    <Cell title="Watched people" count={items.length}>
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
              ? 'Save a token to pick from your organisation'
              : items.length > 0
                ? `${items.length} selected`
                : 'Select people…'}
          </span>
          <span className="ms-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && !disabled && (
          <div className="ms-menu" role="listbox" aria-multiselectable="true">
            <input
              className="ms-search"
              autoFocus
              value={query}
              placeholder="Search your org, or type a login…"
              onChange={(e) => {
                setQuery(e.target.value)
                setInvalid(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canAddManual) {
                  e.preventDefault()
                  addManual()
                }
              }}
              aria-label="Search people"
            />
            <div className="ms-options">
              {loading && <p className="ms-status">Loading your organisation…</p>}
              {!loading && members.length === 0 && (
                <PeopleDiagnosis error={error} skipped={skipped} orgCount={tokenOrgCount} />
              )}
              {!loading && truncated && (
                <p className="ms-status">
                  Showing the first {members.length} members — your org is larger than that. Search
                  narrows this list; anyone past it can still be added by typing their login.
                </p>
              )}
              {!loading && members.length > 0 && filtered.length === 0 && !canAddManual && (
                <p className="ms-status">
                  {backfilling ? 'Still loading more people…' : 'No matching people.'}
                </p>
              )}
              {groups.map(([org, people]) => (
                <div key={org}>
                  {orgCount > 1 && <p className="ms-group">{org}</p>}
                  {people.map((member) => (
                    <label
                      key={member.login}
                      className="ms-option person"
                      role="option"
                      aria-selected={selected.has(member.login)}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(member.login)}
                        onChange={() => toggle(member.login)}
                      />
                      <Avatar login={member.login} />
                      <span className="ms-person">
                        <span>{member.login}</span>
                        {member.name && <em>{member.name}</em>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {canAddManual && (
                <button type="button" className="ms-add" onClick={addManual}>
                  {isLogin(query.trim())
                    ? `Add “${query.trim()}”`
                    : 'Add… (expects a GitHub login)'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {invalid ? (
        <p className="field-error">Invalid format — expected a GitHub username, e.g. octocat</p>
      ) : (
        <p className="field-hint">
          {backfilling
            ? 'Loading more of your organisation…'
            : 'Pick teammates from your organisation, or type any GitHub username.'}
        </p>
      )}
      <SelectionChips items={items} onChange={onChange} />
    </Cell>
  )
}

function AccountRow({ account, isActive }: { account: Account; isActive: boolean }) {
  const { switchAccount, renameAccount, removeAccount } = useAppState()
  const [draft, setDraft] = useState(account.label)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setDraft(account.label)
  }, [account.label])

  function commitLabel() {
    const next = draft.trim()
    if (!next) setDraft(account.label)
    else if (next !== account.label) renameAccount(account.id, next)
  }

  return (
    <li className={isActive ? 'is-active' : undefined}>
      <AccountFace login={account.login} label={account.label} />
      <div className="acct-cell-main">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') setDraft(account.label)
          }}
          aria-label={`Name for ${profileName(account)}`}
        />
        <span className="acct-cell-sub">
          {account.login ? `@${account.login} · ` : ''}
          {account.hasToken ? 'token saved' : 'no token'} ·{' '}
          {scopeSummary(account.config.repos, account.config.users, 'no watchlist yet')}
        </span>
      </div>
      {isActive ? (
        <span className="acct-cell-badge">active</span>
      ) : (
        <button type="button" className="secondary" onClick={() => switchAccount(account.id)}>
          Use
        </button>
      )}
      {confirming ? (
        <span className="acct-cell-confirm">
          <button type="button" onClick={() => removeAccount(account.id)}>
            Delete
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${profileName(account)}`}
        >
          Remove
        </button>
      )}
    </li>
  )
}

function AccountsCell() {
  const { accounts, activeId, addAccount } = useAppState()
  return (
    <Cell title="Accounts" count={accounts.length}>
      <p className="field-hint">
        Each account keeps its own token and its own watchlist. Switching accounts — here or from
        the top bar — swaps both, and every view reloads against the new token.
      </p>
      <ul className="accounts">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} isActive={account.id === activeId} />
        ))}
      </ul>
      <button type="button" onClick={() => addAccount()}>
        Add account
      </button>
    </Cell>
  )
}

export function SettingsPage() {
  const { token, setToken, config, setConfig, accounts, activeId, addAccount } = useAppState()
  const [tokenDraft, setTokenDraft] = useState(token)
  const [copied, setCopied] = useState(false)
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof decodeShareFragment>>(null)
  const viewer = useViewer(token)
  const viewerRepos = useViewerRepos(token)
  const orgMembers = useOrgMembers(token)
  const navigate = useNavigate()

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0]
  const activeName = profileName(active)

  const repoOptions = viewerRepos.repos.filter((r) => !r.isArchived).map((r) => r.nameWithOwner)

  // Every field below edits the active account — follow a switch, don't keep the old draft.
  useEffect(() => {
    setTokenDraft(token)
  }, [activeId, token])

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
        <p>Your tokens and watchlists live in this browser only.</p>
      </div>

      {pendingImport && (
        <div className="import-banner">
          <p>
            This link contains a shared watchlist: <strong>{pendingImport.repos.length}</strong>{' '}
            repos, <strong>{pendingImport.users.length}</strong> people. Import it into{' '}
            <strong>{activeName}</strong> (replacing that account's watchlist), or keep it separate
            as a new account. No token is affected.
          </p>
          <button
            onClick={() => {
              setConfig(pendingImport)
              clearPendingImport()
              navigate('/')
            }}
          >
            Import into {activeName}
          </button>
          <button
            className="secondary"
            onClick={() => {
              addAccount(pendingImport)
              clearPendingImport()
            }}
          >
            Import as new account
          </button>
          <button className="secondary" onClick={clearPendingImport}>
            Dismiss
          </button>
        </div>
      )}

      <AccountsCell />

      <Cell title="GitHub token" note={`Applies to ${activeName} — each account has its own`}>
        <p className="field-hint">
          Fine-grained personal access token, stored only in this browser and sent only to
          api.github.com.
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            setToken(tokenDraft.trim())
          }}
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
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setToken('')
                setTokenDraft('')
              }}
            >
              Clear
            </button>
          )}
        </form>
        {token && viewer.data && <p className="field-ok">✓ Authenticated as {viewer.data}</p>}
        {token && viewer.error && (
          <p className="field-error">Token check failed: {viewer.error.message}</p>
        )}

        <dl className="perms">
          <div>
            <dt>Metadata</dt>
            <dd>Required on every fine-grained token</dd>
          </div>
          <div>
            <dt>Pull requests</dt>
            <dd>PR titles, review decisions, requested reviewers</dd>
          </div>
          <div>
            <dt>Commit statuses</dt>
            <dd>CI badges on the board</dd>
          </div>
          <div>
            <dt>Checks</dt>
            <dd>CI badges for GitHub Actions runs</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>
              Organisation permission — without it the people picker can’t list your teammates
            </dd>
          </div>
        </dl>
        <p className="field-hint">All read-only. No write permission is ever used.</p>
        {owners.size > 1 && (
          <p className="field-warn">
            Your watchlist spans {owners.size} owners ({[...owners].join(', ')}). A fine-grained
            token can only reach one owner's repos, and GitHub returns the rest as missing rather
            than as an error — use a classic token with <code>repo</code> scope, or narrow the
            watchlist.
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

      <PeopleMultiSelect
        items={config.users}
        onChange={(users) => setConfig({ ...config, users })}
        members={orgMembers.members}
        loading={orgMembers.isLoading}
        backfilling={orgMembers.isBackfilling}
        disabled={!token}
        error={orgMembers.error}
        skipped={orgMembers.skipped}
        tokenOrgCount={orgMembers.orgCount}
        truncated={orgMembers.isTruncated}
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
        <p className="field-hint">
          Drives the idle stripe on board cards and the “Idle only” filter.
        </p>
      </Cell>

      <Cell title="Share config">
        <p className="field-hint">
          Copies a link containing your watchlist (repos, people, stale threshold). Your token is
          never included.
        </p>
        <button onClick={copyShareLink}>{copied ? 'Copied ✓' : 'Copy share link'}</button>
      </Cell>
    </div>
  )
}
