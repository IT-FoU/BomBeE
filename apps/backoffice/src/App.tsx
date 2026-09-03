import { APP_ROLES, BRAND_NAME } from '@bombee/shared';

const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'stores', label: 'Stores' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'staff', label: 'Staff & roles' },
  { id: 'audit', label: 'Audit' },
  { id: 'exports', label: 'Exports' },
] as const;

export function App() {
  return (
    <div className="shell">
      <aside className="nav" aria-label="Backoffice navigation">
        <p className="brand">{BRAND_NAME}</p>
        <p className="nav-label">Backoffice</p>
        <nav className="nav-list">
          {navItems.map((item) => (
            <a key={item.id} className="nav-link" href={`#${item.id}`}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <p className="session-note">Session idle limit: 1 hour · New devices require OTP</p>
          <p className="delegation-banner" role="status">
            Active Owner delegation banner appears here when applicable
          </p>
        </header>
        <main className="main">
          <h1>Operations shell</h1>
          <p className="lede">
            Milestone 3 catalog controls: bilingual product copy, media limits, import preview, and
            price approvals. Active selling price is approved-only.
          </p>
          <section aria-labelledby="catalog-heading" id="catalog">
            <h2 id="catalog-heading">Catalog readiness</h2>
            <ul className="roles" aria-label="Catalog checklist">
              <li>Lo / En copy</li>
              <li>SKU unique per store</li>
              <li>Media validation</li>
              <li>Price approval</li>
              <li>Prohibited categories blocked</li>
            </ul>
          </section>
          <section aria-labelledby="stores-heading" id="stores">
            <h2 id="stores-heading">Store readiness</h2>
            <ul className="roles" aria-label="Store checklist">
              <li>Owner ID</li>
              <li>Store info</li>
              <li>Bank account</li>
              <li>Contract</li>
              <li>One fulfillment location</li>
            </ul>
          </section>
          <section aria-labelledby="roles-heading">
            <h2 id="roles-heading">Standard roles</h2>
            <ul className="roles">
              {APP_ROLES.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
