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
  fetchVariantStock,
  listCatalogProducts,
  listCodShipments,
  listInvites,
  listOrders,
  listSettlementBatches,
  listStores,
  mockCreateSettlementBatch,
  mockRemitCodShipment,
  opsConfirmChildren,
  opsMockAdvance,
  opsMockDeliver,
  submitSettlementBatch,
  approveSettlementBatch,
  disputeSettlementBatch,
  listSupportTickets,
  mockCreateSupportTicket,
  replySupportTicket,
  resolveSupportTicket,
  listReturns,
  mockCreateReturn,
  approveReturn,
  listPromotions,
  mockCreatePromotion,
  pausePromotion,
  listRefunds,
  mockCreateRefund,
  approveRefund,
  mockPayRefund,
  listAuditEvents,
  mockAuditEvent,
  listExports,
  mockCreateExport,
  approveExportRequest,
  mockDownloadExport,
  listNotifications,
  mockEnqueueNotification,
  mockProcessNotifications,
  markNotificationRead,
  type CodShipmentRow,
  type IssuedInvite,
  type IssuedStore,
  type OpsCatalogProduct,
  type OpsOrderRow,
  type OpsStockView,
  type SettlementBatchRow,
  type SupportTicketRow,
  type ReturnRequestRow,
  type PromotionRow,
  type RefundApprovalRow,
  type AuditEventRow,
  type ExportRequestRow,
  type NotificationInboxRow,
  type NotificationOutboxRow,
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
  { id: 'returns', label: { lo: 'ສົ່ງຄືນ', en: 'Returns' } },
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
  const [catalogProducts, setCatalogProducts] = useState<OpsCatalogProduct[]>([]);
  const [stockDetail, setStockDetail] = useState<OpsStockView | null>(null);
  const [settlementBatches, setSettlementBatches] = useState<SettlementBatchRow[]>([]);
  const [settlementNote, setSettlementNote] = useState('');
  const [supportTickets, setSupportTickets] = useState<SupportTicketRow[]>([]);
  const [supportNote, setSupportNote] = useState('');
  const [returnRequests, setReturnRequests] = useState<ReturnRequestRow[]>([]);
  const [returnNote, setReturnNote] = useState('');
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [promoNote, setPromoNote] = useState('');
  const [refunds, setRefunds] = useState<RefundApprovalRow[]>([]);
  const [refundNote, setRefundNote] = useState('');
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [auditNote, setAuditNote] = useState('');
  const [exportRequests, setExportRequests] = useState<ExportRequestRow[]>([]);
  const [exportNote, setExportNote] = useState('');
  const [notificationInbox, setNotificationInbox] = useState<NotificationInboxRow[]>([]);
  const [notificationOutbox, setNotificationOutbox] = useState<NotificationOutboxRow[]>([]);
  const [notificationNote, setNotificationNote] = useState('');
  const [remitBusyId, setRemitBusyId] = useState('');
  const [remitNote, setRemitNote] = useState('');

  const invitePreview = useMemo(
    () => inviteDraft.code.trim().toUpperCase() || 'QA-BETA-…',
    [inviteDraft.code],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [
          invites,
          stores,
          cod,
          orders,
          products,
          batches,
          tickets,
          returns,
          promos,
          refundRows,
          auditRows,
          exportRows,
          notificationBundle,
        ] = await Promise.all([
          listInvites(),
          listStores(),
          listCodShipments(),
          listOrders(30),
          listCatalogProducts(50),
          listSettlementBatches(50),
          listSupportTickets(50),
          listReturns(50),
          listPromotions(50),
          listRefunds(50),
          listAuditEvents(50),
          listExports(50),
          listNotifications(50),
        ]);
        setIssuedInvites(invites);
        setStoreDrafts(stores);
        setCodShipments(cod);
        setOpsOrders(orders);
        setCatalogProducts(products);
        setSettlementBatches(batches);
        setSupportTickets(tickets);
        setReturnRequests(returns);
        setPromotions(promos);
        setRefunds(refundRows);
        setAuditEvents(auditRows);
        setExportRequests(exportRows);
        setNotificationInbox(notificationBundle.inbox);
        setNotificationOutbox(notificationBundle.outbox);
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
          <section aria-labelledby="catalog-heading" id="catalog">
            <h2 id="catalog-heading">
              <span lang="en">Catalog</span>
              {' / '}
              <span lang="lo">ສິນຄ້າ</span>
            </h2>
            <p className="lede">Active products from local catalog API (with available qty).</p>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                void (async () => {
                  try {
                    setCatalogProducts(await listCatalogProducts(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'catalog_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh catalog
            </button>
            <ul className="roles" aria-label="Catalog products">
              {catalogProducts.length === 0 ? <li>No products yet</li> : null}
              {catalogProducts.map((p) => (
                <li key={p.id}>
                  {p.titleEn} · {p.storeName} · {formatLak(LAK(p.priceLak))} · avail{' '}
                  {p.availableQty}
                  {p.variants[0] ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          void (async () => {
                            try {
                              setStockDetail(await fetchVariantStock(p.variants[0]!.id));
                            } catch (err) {
                              setFormError(err instanceof Error ? err.message : 'stock_failed');
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Stock
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="inventory-heading" id="inventory">
            <h2 id="inventory-heading">
              <span lang="en">Inventory</span>
              {' / '}
              <span lang="lo">ສະຕັອກ</span>
            </h2>
            <p className="lede">
              Lot balances for a selected variant (use Stock on a catalog row). Available qty already
              shown on Catalog.
            </p>
            {stockDetail ? (
              <ul className="roles" aria-label="Stock balances">
                <li>
                  Variant {stockDetail.variantId.slice(0, 8)}… · available {stockDetail.availableQty}
                </li>
                {stockDetail.balances.map((b) => (
                  <li key={b.balanceId}>
                    {b.lotCode ?? b.lotId.slice(0, 8)} · on hand {b.onHand} · reserved {b.reserved} ·
                    avail {b.available}
                    {b.expiryDate ? ` · exp ${b.expiryDate}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No variant selected yet.</p>
            )}
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
          <section aria-labelledby="settlements-heading" id="settlements">
            <h2 id="settlements-heading">
              <span lang="en">Settlements</span>
              {' / '}
              <span lang="lo">ຈ່າຍຮ້ານ</span>
            </h2>
            <p className="lede">
              Local settlement batches — create draft, submit, approve (maker-checker), or dispute a
              line (delivered + paid children; active payout required).
            </p>
            {settlementNote ? (
              <p className="lede" role="status">
                {settlementNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Settlement batches">
              {settlementBatches.length === 0 ? <li>No settlement batches yet</li> : null}
              {settlementBatches.map((batch) => (
                <li key={batch.batchId}>
                  {batch.status} · {batch.storeName} · {batch.lineCount} lines · net{' '}
                  {formatLak(LAK(batch.netLak))}
                  {batch.status === 'draft' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setSettlementNote('');
                          void (async () => {
                            try {
                              const result = await submitSettlementBatch(batch.batchId);
                              if (result.batches) setSettlementBatches(result.batches);
                              setSettlementNote(
                                `Submitted ${batch.batchId.slice(0, 8)}… → pending_approval`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'settlement_submit_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Submit
                      </button>
                    </>
                  ) : null}
                  {batch.status === 'draft' || batch.status === 'pending_approval' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setSettlementNote('');
                          void (async () => {
                            try {
                              const result = await approveSettlementBatch(batch.batchId);
                              if (result.batches) setSettlementBatches(result.batches);
                              setSettlementNote(
                                `Approved ${batch.batchId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'settlement_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve
                      </button>
                    </>
                  ) : null}
                  {batch.status !== 'partially_disputed' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setSettlementNote('');
                          void (async () => {
                            try {
                              const result = await disputeSettlementBatch(batch.batchId, {
                                reason: 'BO mock dispute',
                              });
                              if (result.batches) setSettlementBatches(result.batches);
                              setSettlementNote(
                                `Disputed ${batch.batchId.slice(0, 8)}… · ${result.disputeId?.slice(0, 8) ?? ''}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'settlement_dispute_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Dispute
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
                setFormError('');
                setSettlementNote('');
                void (async () => {
                  try {
                    const result = await mockCreateSettlementBatch();
                    setSettlementBatches(result.batches);
                    setSettlementNote(
                      `Created draft ${result.batchId.slice(0, 8)}… · ${result.lineCount} lines · net ${formatLak(LAK(result.netLak))}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'settlement_create_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create batch
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setSettlementBatches(await listSettlementBatches(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'settlements_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh settlements
            </button>
          </section>
          <section aria-labelledby="support-heading" id="support">
            <h2 id="support-heading">
              <span lang="en">Support</span>
              {' / '}
              <span lang="lo">ສະໜັບສະໜູນ</span>
            </h2>
            <p className="lede">
              Local support tickets — mock create, staff reply, and preliminary resolve.
            </p>
            {supportNote ? (
              <p className="lede" role="status">
                {supportNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Support tickets">
              {supportTickets.length === 0 ? <li>No support tickets yet</li> : null}
              {supportTickets.map((ticket) => (
                <li key={ticket.ticketId}>
                  {ticket.status} · {ticket.urgency} · {ticket.subject} · {ticket.messageCount}{' '}
                  msgs
                  {ticket.status === 'open' || ticket.status === 'reopened' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setSupportNote('');
                          void (async () => {
                            try {
                              const result = await replySupportTicket(
                                ticket.ticketId,
                                'Local ops: looking into this.',
                              );
                              if (result.tickets) setSupportTickets(result.tickets);
                              setSupportNote(
                                `Replied ${ticket.ticketId.slice(0, 8)}… → awaiting_customer`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'support_reply_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Reply
                      </button>
                    </>
                  ) : null}
                  {ticket.status !== 'closed' &&
                  ticket.status !== 'resolved_pending_confirm' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setSupportNote('');
                          void (async () => {
                            try {
                              const result = await resolveSupportTicket(ticket.ticketId);
                              if (result.tickets) setSupportTickets(result.tickets);
                              setSupportNote(
                                `Resolved ${ticket.ticketId.slice(0, 8)}… → pending confirm`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'support_resolve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Resolve
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
                setFormError('');
                setSupportNote('');
                void (async () => {
                  try {
                    const result = await mockCreateSupportTicket({
                      subject: 'BO mock ticket',
                      body: 'Opened from backoffice Support section.',
                      urgency: 'general',
                    });
                    setSupportTickets(result.tickets);
                    setSupportNote(`Opened ${result.ticketId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'support_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create ticket
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setSupportTickets(await listSupportTickets(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'support_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh tickets
            </button>
          </section>
          <section aria-labelledby="returns-heading" id="returns">
            <h2 id="returns-heading">
              <span lang="en">Returns</span>
              {' / '}
              <span lang="lo">ສົ່ງຄືນ</span>
            </h2>
            <p className="lede">
              Local return requests for delivered children (eligible reasons within the return
              window).
            </p>
            {returnNote ? (
              <p className="lede" role="status">
                {returnNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Return requests">
              {returnRequests.length === 0 ? <li>No return requests yet</li> : null}
              {returnRequests.map((row) => (
                <li key={row.returnRequestId}>
                  {row.status} · {row.reason} · {formatLak(LAK(row.amountLak))} · child{' '}
                  {row.childOrderId.slice(0, 8)}…
                  {row.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setReturnNote('');
                          void (async () => {
                            try {
                              const result = await approveReturn(row.returnRequestId);
                              if (result.returns) setReturnRequests(result.returns);
                              setReturnNote(
                                `Approved ${row.returnRequestId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'return_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve
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
                setFormError('');
                setReturnNote('');
                void (async () => {
                  try {
                    const result = await mockCreateReturn({ reason: 'defective' });
                    setReturnRequests(result.returns);
                    setReturnNote(`Opened ${result.returnRequestId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'return_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create return
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setReturnRequests(await listReturns(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'returns_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh returns
            </button>
          </section>
          <section aria-labelledby="promotions-heading" id="promotions">
            <h2 id="promotions-heading">
              <span lang="en">Promotions</span>
              {' / '}
              <span lang="lo">ໂປຣໂມຊັນ</span>
            </h2>
            <p className="lede">
              Local promotions — mock create active codes and pause them for QA.
            </p>
            {promoNote ? (
              <p className="lede" role="status">
                {promoNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Promotions">
              {promotions.length === 0 ? <li>No promotions yet</li> : null}
              {promotions.map((promo) => (
                <li key={promo.promotionId}>
                  {promo.status} · {promo.code} ·{' '}
                  {promo.percentOff != null
                    ? `${promo.percentOff}%`
                    : formatLak(LAK(promo.amountOffLak ?? 0))}{' '}
                  · budget {formatLak(LAK(promo.budgetLak))}
                  {promo.status === 'active' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setPromoNote('');
                          void (async () => {
                            try {
                              const result = await pausePromotion(promo.promotionId);
                              if (result.promotions) setPromotions(result.promotions);
                              setPromoNote(`Paused ${promo.code}`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'promotion_pause_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Pause
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
                setFormError('');
                setPromoNote('');
                void (async () => {
                  try {
                    const result = await mockCreatePromotion({
                      titleEn: 'BO mock 10% off',
                      percentOff: 10,
                    });
                    setPromotions(result.promotions);
                    setPromoNote(`Created ${result.promotionId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'promotion_create_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create promo
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setPromotions(await listPromotions(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'promotions_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh promotions
            </button>
          </section>
          <section aria-labelledby="notifications-heading" id="notifications">
            <h2 id="notifications-heading">
              <span lang="en">Notifications</span>
              {' / '}
              <span lang="lo">ແຈ້ງເຕືອນ</span>
            </h2>
            <p className="lede">
              Local inbox + outbox — mock enqueue (memory provider), process dispatch, mark
              read.
            </p>
            {notificationNote ? (
              <p className="lede" role="status">
                {notificationNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Notification inbox">
              {notificationInbox.length === 0 ? <li>No inbox messages yet</li> : null}
              {notificationInbox.map((item) => (
                <li key={item.inboxId}>
                  {item.read ? 'read' : 'unread'} · {item.channel} · {item.template} ·{' '}
                  {item.title}
                  {!item.read ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setNotificationNote('');
                          void (async () => {
                            try {
                              const result = await markNotificationRead(item.inboxId);
                              setNotificationInbox(result.inbox);
                              setNotificationOutbox(result.outbox);
                              setNotificationNote(`Marked ${item.inboxId.slice(0, 8)}… read`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'notification_mark_read_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Mark read
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Notification outbox">
              {notificationOutbox.length === 0 ? <li>No outbox jobs yet</li> : null}
              {notificationOutbox.map((job) => (
                <li key={job.outboxId}>
                  {job.status} · {job.provider}/{job.channel} · {job.template} · attempts{' '}
                  {job.attempts}/{job.maxAttempts}
                  {job.lastError ? ` · ${job.lastError}` : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setNotificationNote('');
                void (async () => {
                  try {
                    const result = await mockEnqueueNotification({
                      title: 'Ops ping',
                      body: 'Opened from Notifications section',
                      template: 'ops.backoffice_ping',
                    });
                    setNotificationInbox(result.inbox);
                    setNotificationOutbox(result.outbox);
                    setNotificationNote(`Enqueued ${result.outboxId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'notification_enqueue_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock enqueue
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setNotificationNote('');
                void (async () => {
                  try {
                    const result = await mockProcessNotifications();
                    setNotificationInbox(result.inbox);
                    setNotificationOutbox(result.outbox);
                    setNotificationNote('Processed due outbox jobs');
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'notification_process_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Process outbox
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    const result = await listNotifications(50);
                    setNotificationInbox(result.inbox);
                    setNotificationOutbox(result.outbox);
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'notifications_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh notifications
            </button>
          </section>
          <section aria-labelledby="approvals-heading" id="approvals">
            <h2 id="approvals-heading">
              <span lang="en">Approvals</span>
              {' / '}
              <span lang="lo">ອະນຸມັດ</span>
            </h2>
            <p className="lede">
              Local refund approvals — mock create from paid delivered children, approve
              (maker-checker), then mock-pay via ledger.
            </p>
            {refundNote ? (
              <p className="lede" role="status">
                {refundNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Refund approvals">
              {refunds.length === 0 ? <li>No refund approvals yet</li> : null}
              {refunds.map((row) => (
                <li key={row.approvalId}>
                  {row.status} · {formatLak(LAK(row.amountLak))} · {row.reason} · child{' '}
                  {row.childOrderId.slice(0, 8)}…
                  {row.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setRefundNote('');
                          void (async () => {
                            try {
                              const result = await approveRefund(row.approvalId);
                              if (result.refunds) setRefunds(result.refunds);
                              setRefundNote(
                                `Approved ${row.approvalId.slice(0, 8)}… · SLA ${result.slaDueAt ?? ''}`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'refund_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve
                      </button>
                    </>
                  ) : null}
                  {row.status === 'approved' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setRefundNote('');
                          void (async () => {
                            try {
                              const result = await mockPayRefund(row.approvalId);
                              if (result.refunds) setRefunds(result.refunds);
                              setRefundNote(
                                `Paid ${row.approvalId.slice(0, 8)}…${result.withinSla === false ? ' (SLA miss)' : ''}`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'refund_pay_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Mock pay
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
                setFormError('');
                setRefundNote('');
                void (async () => {
                  try {
                    const result = await mockCreateRefund({ reason: 'BO mock refund' });
                    setRefunds(result.refunds);
                    setRefundNote(`Opened ${result.approvalId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'refund_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create refund
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setRefunds(await listRefunds(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'refunds_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh refunds
            </button>
          </section>
          <section aria-labelledby="audit-heading" id="audit">
            <h2 id="audit-heading">
              <span lang="en">Audit</span>
              {' / '}
              <span lang="lo">ອອດິດ</span>
            </h2>
            <p className="lede">
              Append-only audit events from local ops (settlements, refunds, returns, …).
            </p>
            {auditNote ? (
              <p className="lede" role="status">
                {auditNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Audit events">
              {auditEvents.length === 0 ? <li>No audit events yet</li> : null}
              {auditEvents.map((event) => (
                <li key={event.eventId}>
                  {event.action} · {event.targetType}
                  {event.targetId ? ` · ${event.targetId.slice(0, 8)}…` : ''}
                  {event.reason ? ` · ${event.reason}` : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                setAuditNote('');
                void (async () => {
                  try {
                    const result = await mockAuditEvent({
                      action: 'ops.bo_mock_event',
                      reason: 'Opened from Audit section',
                    });
                    setAuditEvents(result.events);
                    setAuditNote(`Logged ${result.eventId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'audit_mock_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock audit event
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setAuditEvents(await listAuditEvents(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'audit_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh audit
            </button>
          </section>
          <section aria-labelledby="exports-heading" id="exports">
            <h2 id="exports-heading">
              <span lang="en">Exports</span>
              {' / '}
              <span lang="lo">ສົ່ງອອກ</span>
            </h2>
            <p className="lede">
              Encrypted export requests — mock create, approve (maker-checker), then mock download
              (metadata only; ciphertext never returned).
            </p>
            {exportNote ? (
              <p className="lede" role="status">
                {exportNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Export requests">
              {exportRequests.length === 0 ? <li>No export requests yet</li> : null}
              {exportRequests.map((row) => (
                <li key={row.exportId}>
                  {row.status} · {row.exportType} · {row.downloadCount}/{row.downloadLimit} ·{' '}
                  {row.reason}
                  {row.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setExportNote('');
                          void (async () => {
                            try {
                              const result = await approveExportRequest(row.exportId);
                              if (result.exports) setExportRequests(result.exports);
                              setExportNote(`Approved ${row.exportId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'export_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve
                      </button>
                    </>
                  ) : null}
                  {row.status === 'approved' || row.status === 'ready' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setExportNote('');
                          void (async () => {
                            try {
                              const result = await mockDownloadExport(row.exportId);
                              if (result.exports) setExportRequests(result.exports);
                              setExportNote(
                                `Downloaded ${row.exportId.slice(0, 8)}… · count ${result.downloadCount ?? ''}`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'export_download_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Mock download
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
                setFormError('');
                setExportNote('');
                void (async () => {
                  try {
                    const result = await mockCreateExport({
                      exportType: 'orders_summary',
                      reason: 'BO mock compliance extract',
                    });
                    setExportRequests(result.exports);
                    setExportNote(`Created ${result.exportId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'export_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create export
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setExportRequests(await listExports(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'exports_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh exports
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
                  'catalog',
                  'inventory',
                  'settlements',
                  'support',
                  'returns',
                  'promotions',
                  'approvals',
                  'audit',
                  'exports',
                  'notifications',
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
