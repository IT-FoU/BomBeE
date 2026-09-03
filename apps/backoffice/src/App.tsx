import {
  APP_ROLES,
  BRAND_NAME,
  LAK,
  formatDisplayDate,
  formatLak,
  t,
  type UiLocale,
} from '@bombee/shared';

const navItems = [
  { id: 'dashboard', label: { lo: 'ແຜງຄວບຄຸມ', en: 'Dashboard' } },
  { id: 'stores', label: { lo: 'ຮ້ານ', en: 'Stores' } },
  { id: 'catalog', label: { lo: 'ສິນຄ້າ', en: 'Catalog' } },
  { id: 'inventory', label: { lo: 'ສະຕັອກ', en: 'Inventory' } },
  { id: 'orders', label: { lo: 'ອໍເດີ', en: 'Orders' } },
  { id: 'payments', label: { lo: 'ການຊຳລະ', en: 'Payments' } },
  { id: 'fulfillment', label: { lo: 'ຈັດສົ່ງ', en: 'Fulfillment' } },
  { id: 'settlements', label: { lo: 'ຈ່າຍຮ້ານ', en: 'Settlements' } },
  { id: 'promotions', label: { lo: 'ໂປຣໂມຊັນ', en: 'Promotions' } },
  { id: 'support', label: { lo: 'ສະໜັບສະໜູນ', en: 'Support' } },
  { id: 'integrations', label: { lo: 'ການເຊື່ອມຕໍ່', en: 'Integrations' } },
  { id: 'notifications', label: { lo: 'ແຈ້ງເຕືອນ', en: 'Notifications' } },
  { id: 'approvals', label: { lo: 'ອະນຸມັດ', en: 'Approvals' } },
  { id: 'staff', label: { lo: 'ພະນັກງານ', en: 'Staff & roles' } },
  { id: 'audit', label: { lo: 'ອອດິດ', en: 'Audit' } },
  { id: 'exports', label: { lo: 'ສົ່ງອອກ', en: 'Exports' } },
] as const;

const SAMPLE_AMOUNT = LAK(1_250_000);
const SAMPLE_DATE = '2026-09-03T04:00:00.000Z';

export function App({ locale = 'en' as UiLocale }: { locale?: UiLocale }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="nav" aria-label={t('backoffice', locale)}>
        <p className="brand">{BRAND_NAME}</p>
        <p className="nav-label">{t('backoffice', locale)}</p>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item.id}
              className="nav-link"
              href={`#${item.id}`}
              aria-label={`${item.label.en} / ${item.label.lo}`}
            >
              <span lang="en">{item.label.en}</span>
              <span className="nav-lo" lang="lo">
                {item.label.lo}
              </span>
            </a>
          ))}
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <p className="session-note">{t('sessionIdle', locale)}</p>
          <p className="delegation-banner" role="status" aria-live="polite">
            Active Owner delegation banner appears here when applicable
          </p>
          <p className="prod-guard" role="status">
            {t('noProductionData', locale)}
          </p>
        </header>
        <main className="main" id="main-content" tabIndex={-1}>
          <h1>{t('operationsShell', locale)}</h1>
          <p className="lede">
            Milestone 10 final QA: responsive shell, keyboard focus, Lo/En labels, LAK/date
            formatting, and security audit evidence before Customer PWA.
          </p>
          <section aria-labelledby="format-heading" id="formats">
            <h2 id="format-heading">Locale formatting</h2>
            <p>
              <span lang="en">Amount (en): {formatLak(SAMPLE_AMOUNT, 'en-US')}</span>
              {' · '}
              <span lang="lo">ຈຳນວນ (lo): {formatLak(SAMPLE_AMOUNT, 'lo-LA')}</span>
            </p>
            <p>
              <span lang="en">Date (en): {formatDisplayDate(SAMPLE_DATE, 'en')}</span>
              {' · '}
              <span lang="lo">ວັນທີ (lo): {formatDisplayDate(SAMPLE_DATE, 'lo')}</span>
            </p>
          </section>
          <section aria-labelledby="a11y-heading" id="accessibility">
            <h2 id="a11y-heading">Accessibility checklist</h2>
            <ul className="roles" aria-label="Accessibility checklist">
              <li>Skip link</li>
              <li>Focus-visible nav</li>
              <li>Labeled regions</li>
              <li>Contrast navy/blue</li>
              <li>Error live region ready</li>
            </ul>
            <div className="error-demo" role="alert" aria-live="assertive">
              Example error: approval denied — self-approval is not allowed.
            </div>
          </section>
          <section aria-labelledby="qa-heading" id="dashboard">
            <h2 id="qa-heading">Responsive QA surfaces</h2>
            <ul className="roles" aria-label="Viewport checklist">
              <li>Desktop shell</li>
              <li>Tablet sticky nav</li>
              <li>Mobile horizontal nav</li>
              <li>Lo/En overflow wrap</li>
              <li>All {APP_ROLES.length} roles listed</li>
            </ul>
          </section>
          <section aria-labelledby="integrations-heading" id="integrations">
            <h2 id="integrations-heading">Integration Center</h2>
            <ul className="roles" aria-label="Integration checklist">
              <li>EGO: Disabled/Not configured</li>
              <li>Flag default OFF</li>
              <li>No credentials</li>
              <li>No mock SMS in production</li>
              <li>No demo auth bypass</li>
            </ul>
          </section>
          <section aria-labelledby="roles-heading" id="staff">
            <h2 id="roles-heading">Standard roles</h2>
            <ul className="roles" aria-label="Standard staff roles">
              {APP_ROLES.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </section>
          {navItems
            .filter((item) => !['dashboard', 'integrations', 'staff'].includes(item.id))
            .map((item) => (
              <section key={item.id} aria-labelledby={`${item.id}-heading`} id={item.id}>
                <h2 id={`${item.id}-heading`}>
                  <span lang="en">{item.label.en}</span>
                  {' / '}
                  <span lang="lo">{item.label.lo}</span>
                </h2>
                <p className="lede">Section ready for role-scoped operations.</p>
              </section>
            ))}
        </main>
      </div>
    </div>
  );
}

export const BACKOFFICE_NAV_IDS = navItems.map((item) => item.id);
