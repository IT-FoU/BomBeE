import { APP_ROLES, BRAND_NAME } from '@bombee/shared';

const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'stores', label: 'Stores' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'orders', label: 'Orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'fulfillment', label: 'Fulfillment' },
  { id: 'settlements', label: 'Settlements' },
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
            Milestone 7 fulfillment: packing SLA, courier handoff/POD, returns and refunds,
            product recalls, and maker-checker store settlements.
          </p>
          <section aria-labelledby="settlements-heading" id="settlements">
            <h2 id="settlements-heading">Settlement readiness</h2>
            <ul className="roles" aria-label="Settlement checklist">
              <li>Delivered + paid only</li>
              <li>Contract cadence</li>
              <li>Maker ≠ approver</li>
              <li>Dispute hold</li>
              <li>Negative carryforward</li>
            </ul>
          </section>
          <section aria-labelledby="fulfillment-heading" id="fulfillment">
            <h2 id="fulfillment-heading">Fulfillment readiness</h2>
            <ul className="roles" aria-label="Fulfillment checklist">
              <li>Pack within 24h</li>
              <li>Tracking + POD</li>
              <li>Return window 7d</li>
              <li>Refund SLA</li>
              <li>Recall completeness</li>
            </ul>
          </section>
          <section aria-labelledby="payments-heading" id="payments">
            <h2 id="payments-heading">Payment readiness</h2>
            <ul className="roles" aria-label="Payment checklist">
              <li>QR combined allocation</li>
              <li>COD limit + deposit</li>
              <li>Idempotent confirm</li>
              <li>Bank reconcile</li>
              <li>Adjustment dual approve</li>
            </ul>
          </section>
          <section aria-labelledby="orders-heading" id="orders">
            <h2 id="orders-heading">Order readiness</h2>
            <ul className="roles" aria-label="Order checklist">
              <li>Parent / child</li>
              <li>Item snapshots</li>
              <li>State machine</li>
              <li>Cancel before handoff</li>
              <li>Split shipment approval</li>
            </ul>
          </section>
          <section aria-labelledby="inventory-heading" id="inventory">
            <h2 id="inventory-heading">Inventory readiness</h2>
            <ul className="roles" aria-label="Inventory checklist">
              <li>Lot + expiry</li>
              <li>Safety buffer</li>
              <li>QR/COD reserve</li>
              <li>No negative stock</li>
              <li>3-day verification</li>
            </ul>
          </section>
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
