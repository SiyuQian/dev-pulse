import { useAppState } from '../../state/AppState'
import { clearPrivateClientData } from '../../storage/securityMigration'
import { AccountFace } from '../shared/ui'

/** The authenticated GitHub identity. Account switching now happens through GitHub sign-in. */
export function AccountSwitcher() {
  const { login } = useAppState()

  return (
    <div className="acct">
      <span className="acct-control" title={`Signed in as @${login}`}>
        <AccountFace login={login} label={login} />
        <span className="acct-label">@{login}</span>
      </span>
      {/* POST via a form: logout is POST-only so third-party pages can't trigger it. */}
      <form method="post" action="/api/auth/logout" onSubmit={() => clearPrivateClientData()}>
        <button type="submit" className="acct-logout">
          Sign out
        </button>
      </form>
    </div>
  )
}
