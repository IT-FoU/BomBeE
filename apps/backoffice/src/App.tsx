import { APP_ROLES, BRAND_NAME } from '@bombee/shared';

export function App() {
  return (
    <div className="shell">
      <aside className="nav">
        <p className="brand">{BRAND_NAME}</p>
        <p className="nav-label">Backoffice</p>
      </aside>
      <main className="main">
        <h1>Operations shell</h1>
        <p className="lede">
          Milestone 0 foundation. Auth, roles, and modules arrive in Milestone 1+.
        </p>
        <ul className="roles" aria-label="Standard roles">
          {APP_ROLES.map((role) => (
            <li key={role}>{role}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
