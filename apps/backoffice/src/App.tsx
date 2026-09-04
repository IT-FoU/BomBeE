import { useEffect, useMemo, useState } from 'react';

import {
  APP_ROLES,
  BRAND_NAME,
  LAK,
  formatDisplayDate,
  formatLak,
  t,
  type UiLocale,
} from '@bombee/shared';

import {
  createInvite,
  createStoreDraft,
  listCodShipments,
  listInvites,
  listOrders,
  listStores,
  mockRemitCodShipment,
  opsConfirmChildren,
  opsMockAdvance,
  opsMockDeliver,
  type CodShipmentRow,
  type IssuedInvite,
  type IssuedStore,
  type OpsOrderRow,
} from './lib/opsApi';

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
  { id: 'invites', label: { lo: 'ເຊີນເຂົ້າ', en: 'Beta invites' } },
  { id: 'audit', label: { lo: 'ອອດິດ', en: 'Audit' } },
  { id: 'exports', label: { lo: 'ສົ່ງອອກ', en: 'Exports' } },
] as const;

const SAMPLE_AMOUNT = LAK(1_250_000);
const SAMPLE_DATE = '2026-09-03T04:00:00.000Z';

type InviteDraft = {
  code: string;
  role: 'customer' | 'store_owner' | 'ops';
  maxUses: number;
  note: string;
};

export function App({ locale = 'en' as UiLocale }: { locale?: UiLocale }) {
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({
    code: '',
    role: 'customer',
    maxUses: 1,
    note: '',
  });
  const [issuedInvites, setIssuedInvites] = useState<IssuedInvite[]>([]);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [storeDraftName, setStoreDraftName] = useState('');
  const [storeDrafts, setStoreDrafts] = useState<IssuedStore[]>([]);
  const [codShipments, setCodShipments] = useState<CodShipmentRow[]>([]);
  const [opsOrders, setOpsOrders] = useState<OpsOrderRow[]>([]);
  const [remitBusyId, setRemitBusyId] = useState('');
  const [remitNote, setRemitNote] = useState('');

  const invitePreview = useMemo(
    () => inviteDraft.code.trim().toUpperCase() || 'QA-BETA-…',
    [inviteDraft.code],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [invites, stores, cod, orders] = await Promise.all([
          listInvites(),
          listStores(),
          listCodShipments(),
          listOrders(30),
        ]);
        setIssuedInvites(invites);
        setStoreDrafts(stores);
        setCodShipments(cod);
        setOpsOrders(orders);
      } catch {
        /* API may be down during static shell QA */
      }
    })();
  }, []);

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
            Phase 2 backoffice: invite + store drafts persist to local API (PGlite mock; no
            Production data).
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
          <section aria-labelledby="invites-heading" id="invites">
            <h2 id="invites-heading">
              <span lang="en">Beta invites</span>
              {' / '}
              <span lang="lo">ເຊີນເຂົ້າ</span>
            </h2>
            <p className="lede">Issue invite-only codes for Private Beta (local API).</p>
            <form
              className="ops-form"
              onSubmit={(event) => {
                event.preventDefault();
                const code = inviteDraft.code.trim().toUpperCase();
                if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
                  setFormError('Invite code must be 4–32 chars (A–Z, 0–9, -)');
                  return;
                }
                setFormBusy(true);
                setFormError('');
                void (async () => {
                  try {
                    const invite = await createInvite({
                      inviteCode: code,
                      intendedRole: inviteDraft.role,
                      maxUses: inviteDraft.maxUses,
                      note: inviteDraft.note.trim() || undefined,
                    });
                    setIssuedInvites((rows) => [invite, ...rows.filter((r) => r.id !== invite.id)]);
                    setInviteDraft({ code: '', role: 'customer', maxUses: 1, note: '' });
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'invite_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              <label>
                Code
                <input
                  value={inviteDraft.code}
                  onChange={(e) => setInviteDraft((d) => ({ ...d, code: e.target.value }))}
                  placeholder="QA-BETA-001"
                  aria-label="Invite code"
                />
              </label>
              <label>
                Role
                <select
                  value={inviteDraft.role}
                  onChange={(e) =>
                    setInviteDraft((d) => ({
                      ...d,
                      role: e.target.value as InviteDraft['role'],
                    }))
                  }
                  aria-label="Invite role"
                >
                  <option value="customer">customer</option>
                  <option value="store_owner">store_owner</option>
                  <option value="ops">ops</option>
                </select>
              </label>
              <label>
                Max uses
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={inviteDraft.maxUses}
                  onChange={(e) =>
                    setInviteDraft((d) => ({
                      ...d,
                      maxUses: Number(e.target.value) || 1,
                    }))
                  }
                  aria-label="Max uses"
                />
              </label>
              <label>
                Note
                <input
                  value={inviteDraft.note}
                  onChange={(e) => setInviteDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder="synthetic QA"
                  aria-label="Invite note"
                />
              </label>
              <p className="lede">Preview: {invitePreview}</p>
              {formError ? (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <button type="submit" className="cta" disabled={formBusy}>
                Issue invite
              </button>
            </form>
            <ul className="roles" aria-label="Drafted invites">
              {issuedInvites.length === 0 ? <li>No invites yet</li> : null}
              {issuedInvites.map((row) => (
                <li key={row.id}>
                  {row.inviteCode} · {row.intendedRole} · used {row.useCount}/{row.maxUses}
                  {row.note ? ` · ${row.note}` : ''}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="stores-heading" id="stores">
            <h2 id="stores-heading">
              <span lang="en">Stores</span>
              {' / '}
              <span lang="lo">ຮ້ານ</span>
            </h2>
            <p className="lede">Create a local store draft (PGlite; not Production).</p>
            <form
              className="ops-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = storeDraftName.trim();
                if (name.length < 2) return;
                setFormBusy(true);
                setFormError('');
                void (async () => {
                  try {
                    const store = await createStoreDraft({ name });
                    setStoreDrafts((rows) => [store, ...rows.filter((r) => r.id !== store.id)]);
                    setStoreDraftName('');
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'store_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              <label>
                Store name
                <input
                  value={storeDraftName}
                  onChange={(e) => setStoreDraftName(e.target.value)}
                  placeholder="QA Store Vientiane"
                  aria-label="Store draft name"
                />
              </label>
              <button type="submit" className="cta" disabled={formBusy}>
                Create store draft
              </button>
            </form>
            <ul className="roles" aria-label="Store drafts">
              {storeDrafts.length === 0 ? <li>No store drafts yet</li> : null}
              {storeDrafts.map((store) => (
                <li key={store.id}>
                  {store.name} · {store.code} · {store.status}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="orders-heading" id="orders">
            <h2 id="orders-heading">
              <span lang="en">Orders</span>
              {' / '}
              <span lang="lo">ອໍເດີ</span>
            </h2>
            <p className="lede">Recent parent orders from local API (PGlite mock).</p>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                void (async () => {
                  try {
                    setOpsOrders(await listOrders(30));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'orders_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh orders
            </button>
            <ul className="roles" aria-label="Recent orders">
              {opsOrders.length === 0 ? <li>No orders yet</li> : null}
              {opsOrders.map((order) => (
                <li key={order.parentId}>
                  {order.orderNumber} · {order.status} · {formatLak(LAK(order.totalLak))} ·{' '}
                  {order.children.length} child
                  {order.children.length === 1 ? '' : 'ren'} (
                  {order.children.map((c) => c.status).join(', ')})
                  <div className="ops-form">
                    <button
                      type="button"
                      className="cta"
                      disabled={formBusy}
                      onClick={() => {
                        setFormBusy(true);
                        setFormError('');
                        void (async () => {
                          try {
                            const result = await opsConfirmChildren(order.parentId);
                            if (result.orders) setOpsOrders(result.orders);
                          } catch (err) {
                            setFormError(err instanceof Error ? err.message : 'confirm_failed');
                          } finally {
                            setFormBusy(false);
                          }
                        })();
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="cta"
                      disabled={formBusy}
                      onClick={() => {
                        setFormBusy(true);
                        setFormError('');
                        void (async () => {
                          try {
                            const result = await opsMockAdvance(order.parentId);
                            if (result.orders) setOpsOrders(result.orders);
                          } catch (err) {
                            setFormError(err instanceof Error ? err.message : 'advance_failed');
                          } finally {
                            setFormBusy(false);
                          }
                        })();
                      }}
                    >
                      Advance
                    </button>
                    <button
                      type="button"
                      className="cta"
                      disabled={formBusy}
                      onClick={() => {
                        setFormBusy(true);
                        setFormError('');
                        void (async () => {
                          try {
                            const result = await opsMockDeliver(order.parentId);
                            if (result.orders) setOpsOrders(result.orders);
                          } catch (err) {
                            setFormError(err instanceof Error ? err.message : 'deliver_failed');
                          } finally {
                            setFormBusy(false);
                          }
                        })();
                      }}
                    >
                      Deliver
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="fulfillment-heading" id="fulfillment">
            <h2 id="fulfillment-heading">
              <span lang="en">Fulfillment</span>
              {' / '}
              <span lang="lo">ຈັດສົ່ງ</span>
            </h2>
            <p className="lede">
              Use Confirm / Advance / Deliver on each order in the Orders section (local mock ops;
              no customer session required).
            </p>
          </section>
          <section aria-labelledby="payments-heading" id="payments">
            <h2 id="payments-heading">
              <span lang="en">Payments</span>
              {' / '}
              <span lang="lo">ການຊຳລະ</span>
            </h2>
            <p className="lede">
              Local COD shipments — mock remittance records courier cash-in (does not change
              delivery status).
            </p>
            {remitNote ? (
              <p className="lede" role="status">
                {remitNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="COD shipments">
              {codShipments.length === 0 ? <li>No COD shipments yet</li> : null}
              {codShipments.map((row) => (
                <li key={row.codShipmentId}>
                  {row.status} · due {formatLak(LAK(row.balanceDueLak))} · child{' '}
                  {row.childOrderId.slice(0, 8)}…
                  {row.status === 'collected' || row.status === 'open' || row.status === 'remitted' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={remitBusyId === row.codShipmentId || formBusy}
                        onClick={() => {
                          setRemitBusyId(row.codShipmentId);
                          setRemitNote('');
                          setFormError('');
                          void (async () => {
                            try {
                              const result = await mockRemitCodShipment(row.codShipmentId, {
                                courierRef: 'BO-MOCK-REM',
                              });
                              setCodShipments((rows) =>
                                rows.map((r) =>
                                  r.codShipmentId === row.codShipmentId
                                    ? { ...r, status: result.status }
                                    : r,
                                ),
                              );
                              setRemitNote(
                                `Remitted ${formatLak(LAK(result.amountLak))} · diff ${result.reconcile.difference}${
                                  result.idempotentReplay ? ' (replay)' : ''
                                }`,
                              );
                            } catch (err) {
                              setFormError(err instanceof Error ? err.message : 'remit_failed');
                            } finally {
                              setRemitBusyId('');
                            }
                          })();
                        }}
                      >
                        Mock remit
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setCodShipments(await listCodShipments());
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'cod_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh COD list
            </button>
          </section>
          {navItems
            .filter(
              (item) =>
                ![
                  'dashboard',
                  'integrations',
                  'staff',
                  'invites',
                  'stores',
                  'payments',
                  'orders',
                  'fulfillment',
                ].includes(item.id),
            )
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
