import { useAppState } from '../../state/AppState'
import { clearPrivateClientData } from '../../storage/securityMigration'
import { AccountFace } from '../shared/ui'

/** The authenticated GitHub identity. Account switching now happens through GitHub sign-in. */
export function AccountSwitcher() {
  const { accounts } = useAppState()
  const account = accounts[0]
  if (!account) return null

  return (
    <div className="acct">
      <span className="acct-control" title={`Signed in as @${account.login}`}>
        <AccountFace login={account.login} label={account.label} />
        <span className="acct-label">@{account.login}</span>
      </span>
      <a className="acct-logout" href="/api/auth/logout" onClick={() => clearPrivateClientData()}>
        Sign out
      </a>
    </div>
  )
}
