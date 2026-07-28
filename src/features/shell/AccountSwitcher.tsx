import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../state/AppState'
import { useViewer } from '../../api/queries'
import { profileName } from '../../storage/config'
import { AccountFace } from '../shared/ui'
import { scopeSummary } from '../shared/format'

/**
 * Switches which GitHub account the whole console reads through. Each account
 * carries its own token and its own watchlist, so switching swaps both at once.
 */
export function AccountSwitcher() {
  const { token, accounts, activeId, switchAccount, addAccount, noteLogin } = useAppState()
  const { data: viewer, error } = useViewer(token)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Stamp the resolved login onto the active account so every row in the menu
  // can be labelled by identity, not just by nickname.
  useEffect(() => {
    if (viewer) noteLogin(viewer)
  }, [viewer, noteLogin])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0]
  if (!active) return null

  const needsToken = !token
  const tokenBad = Boolean(token && error)

  return (
    <div className="acct" ref={rootRef}>
      <button
        type="button"
        className="acct-control"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Account: ${profileName(active)} — click to switch`}
      >
        <AccountFace login={active.login} label={active.label} />
        <span className="acct-label">{profileName(active)}</span>
        {needsToken && <i className="acct-flag" title="No token saved" />}
        {tokenBad && <i className="acct-flag bad" title="Token rejected by GitHub" />}
        {accounts.length > 1 && <span className="acct-count">{accounts.length}</span>}
        <span className="acct-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="acct-menu" role="listbox" aria-label="Accounts">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`acct-row${account.id === activeId ? ' is-active' : ''}`}
              role="option"
              aria-selected={account.id === activeId}
              onClick={() => {
                switchAccount(account.id)
                setOpen(false)
              }}
            >
              <AccountFace login={account.login} label={account.label} />
              <span className="acct-row-main">
                <span className="acct-row-name">
                  {profileName(account)}
                  {/* Only a nickname the user actually chose earns a second line of ink. */}
                  {account.login && !/^Account \d+$/.test(account.label) && (
                    <em>{account.label}</em>
                  )}
                </span>
                <span className="acct-row-sub">
                  {account.hasToken
                    ? scopeSummary(account.config.repos, account.config.users, 'no watchlist yet')
                    : 'no token — add one in Settings'}
                </span>
              </span>
              {account.id === activeId && (
                <span className="acct-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}

          <div className="acct-actions">
            <button
              type="button"
              onClick={() => {
                addAccount()
                setOpen(false)
                navigate('/settings')
              }}
            >
              Add account
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setOpen(false)
                navigate('/settings')
              }}
            >
              Manage
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
