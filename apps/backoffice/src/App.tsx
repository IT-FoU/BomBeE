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
  listInventoryAdjustments,
  opsReceiveStock,
  opsAdjustStock,
  listStockImportBatches,
  previewStockImport,
  commitStockImport,
  listCatalogProducts,
  listCatalogImportBatches,
  previewCatalogImport,
  commitCatalogImport,
  listCatalogMedia,
  mockUploadCatalogMedia,
  issueCatalogMediaSignedUrl,
  listCodShipments,
  listInvites,
  listOrders,
  listSettlementBatches,
  listStores,
  listStoreDocuments,
  fetchStoreOnboarding,
  mockUploadStoreDocument,
  verifyStoreDocument,
  issueStoreDocumentSignedAccess,
  mockEnsureStoreFulfillment,
  activateStore,
  mockCreateSettlementBatch,
  mockRemitCodShipment,
  opsConfirmChildren,
  opsMockAdvance,
  opsMockDeliver,
  listSplitShipments,
  mockRequestSplitShipment,
  approveSplitShipment,
  submitSettlementBatch,
  approveSettlementBatch,
  disputeSettlementBatch,
  listSettlementCarryforwards,
  holdSettlementLine,
  mockSettlementCarryforward,
  listSupportTickets,
  mockCreateSupportTicket,
  replySupportTicket,
  resolveSupportTicket,
  mockEvaluateSupportSla,
  listReturns,
  mockCreateReturn,
  approveReturn,
  listDeliveryClaims,
  mockOpenDeliveryClaim,
  resolveDeliveryClaim,
  listPackingDeadlines,
  mockEvaluatePackingDeadline,
  listPromotions,
  mockCreatePromotion,
  pausePromotion,
  listRefunds,
  mockCreateRefund,
  approveRefund,
  mockPayRefund,
  listPriceRequests,
  mockProposePrice,
  approvePriceRequest,
  listNearExpiryRequests,
  mockProposeNearExpiry,
  approveNearExpiryRequest,
  listReconMismatches,
  listPaymentAdjustments,
  mockCreateMismatch,
  resolveReconMismatch,
  approvePaymentAdjustment,
  listContracts,
  mockCreateContract,
  listPayoutRequests,
  mockProposePayout,
  approvePayoutRequest,
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
  listIntegrations,
  mockEnsureEgoProfiles,
  listStaffDirectory,
  mockLockStaff,
  unlockStaff,
  fetchDashboardKpis,
  fetchPaymentsReconcile,
  listBackups,
  mockRunBackup,
  verifyBackup,
  restoreDrillBackup,
  listDeletionRequests,
  approveDeletionRequest,
  listRecoveryRequests,
  listReviews,
  mockCreateReview,
  listSupplierResponses,
  submitSupplierResponse,
  approveSupplierResponse,
  listTikTokLinks,
  mockSubmitTikTokLink,
  moderateTikTokLink,
  listRecalls,
  mockStartRecall,
  contactRecallAffected,
  listStoreQuality,
  mockQualityEvent,
  reactivateStore,
  type CodShipmentRow,
  type IssuedInvite,
  type IssuedStore,
  type StoreDocumentRow,
  type StoreOnboarding,
  type OpsCatalogProduct,
  type CatalogImportBatchRow,
  type CatalogMediaRow,
  type OpsOrderRow,
  type SplitShipmentRequestRow,
  type OpsStockView,
  type InventoryAdjustmentRow,
  type StockImportBatchRow,
  type SettlementBatchRow,
  type SettlementCarryforwardRow,
  type SupportTicketRow,
  type ReturnRequestRow,
  type DeliveryClaimRow,
  type PackingDeadlineRow,
  type PromotionRow,
  type RefundApprovalRow,
  type PriceRequestRow,
  type NearExpiryRequestRow,
  type ReconMismatchRow,
  type PaymentAdjustmentRow,
  type ContractVersionRow,
  type PayoutRequestRow,
  type PayoutAccountRow,
  type AuditEventRow,
  type ExportRequestRow,
  type NotificationInboxRow,
  type NotificationOutboxRow,
  type IntegrationsStatus,
  type StaffDirectoryRow,
  type StaffRoleCatalogRow,
  type DashboardKpis,
  type PaymentsReconcile,
  type BackupJobRow,
  type BackupAlertRow,
  type DeletionRequestRow,
  type RecoveryRequestRow,
  type ReviewRow,
  type SupplierResponseRow,
  type TikTokLinkRow,
  type RecallRow,
  type QualityEventRow,
  type SuspensionRow,
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
  { id: 'backups', label: { lo: 'ສຳຮອງ', en: 'Backups' } },
  { id: 'privacy', label: { lo: 'ຄວາມເປັນສ່ວນຕົວ', en: 'Privacy' } },
  { id: 'content', label: { lo: 'ເນື້ອຫາ', en: 'Content' } },
  { id: 'recalls', label: { lo: 'ເອີ້ນຄືນ', en: 'Recalls' } },
  { id: 'quality', label: { lo: 'ຄຸນນະພາບ', en: 'Quality' } },
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
  const [storeDocuments, setStoreDocuments] = useState<StoreDocumentRow[]>([]);
  const [storeOnboarding, setStoreOnboarding] = useState<StoreOnboarding | null>(null);
  const [onboardNote, setOnboardNote] = useState('');
  const [codShipments, setCodShipments] = useState<CodShipmentRow[]>([]);
  const [opsOrders, setOpsOrders] = useState<OpsOrderRow[]>([]);
  const [splitShipments, setSplitShipments] = useState<SplitShipmentRequestRow[]>([]);
  const [ordersNote, setOrdersNote] = useState('');
  const [catalogProducts, setCatalogProducts] = useState<OpsCatalogProduct[]>([]);
  const [importBatches, setImportBatches] = useState<CatalogImportBatchRow[]>([]);
  const [catalogMedia, setCatalogMedia] = useState<CatalogMediaRow[]>([]);
  const [catalogNote, setCatalogNote] = useState('');
  const [stockDetail, setStockDetail] = useState<OpsStockView | null>(null);
  const [inventoryAdjustments, setInventoryAdjustments] = useState<InventoryAdjustmentRow[]>([]);
  const [stockImportBatches, setStockImportBatches] = useState<StockImportBatchRow[]>([]);
  const [inventoryNote, setInventoryNote] = useState('');
  const [settlementBatches, setSettlementBatches] = useState<SettlementBatchRow[]>([]);
  const [settlementCarryforwards, setSettlementCarryforwards] = useState<
    SettlementCarryforwardRow[]
  >([]);
  const [settlementNote, setSettlementNote] = useState('');
  const [supportTickets, setSupportTickets] = useState<SupportTicketRow[]>([]);
  const [supportNote, setSupportNote] = useState('');
  const [returnRequests, setReturnRequests] = useState<ReturnRequestRow[]>([]);
  const [returnNote, setReturnNote] = useState('');
  const [deliveryClaims, setDeliveryClaims] = useState<DeliveryClaimRow[]>([]);
  const [packingDeadlines, setPackingDeadlines] = useState<PackingDeadlineRow[]>([]);
  const [fulfillmentNote, setFulfillmentNote] = useState('');
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [promoNote, setPromoNote] = useState('');
  const [refunds, setRefunds] = useState<RefundApprovalRow[]>([]);
  const [refundNote, setRefundNote] = useState('');
  const [priceRequests, setPriceRequests] = useState<PriceRequestRow[]>([]);
  const [pricingNote, setPricingNote] = useState('');
  const [nearExpiryRequests, setNearExpiryRequests] = useState<NearExpiryRequestRow[]>([]);
  const [reconMismatches, setReconMismatches] = useState<ReconMismatchRow[]>([]);
  const [paymentAdjustments, setPaymentAdjustments] = useState<PaymentAdjustmentRow[]>([]);
  const [adjustNote, setAdjustNote] = useState('');
  const [contractVersions, setContractVersions] = useState<ContractVersionRow[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequestRow[]>([]);
  const [payoutAccounts, setPayoutAccounts] = useState<PayoutAccountRow[]>([]);
  const [payoutNote, setPayoutNote] = useState('');
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [auditNote, setAuditNote] = useState('');
  const [exportRequests, setExportRequests] = useState<ExportRequestRow[]>([]);
  const [exportNote, setExportNote] = useState('');
  const [notificationInbox, setNotificationInbox] = useState<NotificationInboxRow[]>([]);
  const [notificationOutbox, setNotificationOutbox] = useState<NotificationOutboxRow[]>([]);
  const [notificationNote, setNotificationNote] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [integrationsNote, setIntegrationsNote] = useState('');
  const [staffRoles, setStaffRoles] = useState<StaffRoleCatalogRow[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryRow[]>([]);
  const [staffNote, setStaffNote] = useState('');
  const [dashboardKpis, setDashboardKpis] = useState<DashboardKpis | null>(null);
  const [paymentsReconcile, setPaymentsReconcile] = useState<PaymentsReconcile | null>(null);
  const [dashboardNote, setDashboardNote] = useState('');
  const [backupJobs, setBackupJobs] = useState<BackupJobRow[]>([]);
  const [backupAlerts, setBackupAlerts] = useState<BackupAlertRow[]>([]);
  const [backupNote, setBackupNote] = useState('');
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequestRow[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<RecoveryRequestRow[]>([]);
  const [privacyNote, setPrivacyNote] = useState('');
  const [productReviews, setProductReviews] = useState<ReviewRow[]>([]);
  const [supplierResponses, setSupplierResponses] = useState<SupplierResponseRow[]>([]);
  const [tiktokLinks, setTiktokLinks] = useState<TikTokLinkRow[]>([]);
  const [contentNote, setContentNote] = useState('');
  const [recallRows, setRecallRows] = useState<RecallRow[]>([]);
  const [recallNote, setRecallNote] = useState('');
  const [qualityEvents, setQualityEvents] = useState<QualityEventRow[]>([]);
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([]);
  const [qualityNote, setQualityNote] = useState('');
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
          storeDocs,
          cod,
          orders,
          splitRows,
          products,
          importBatchRows,
          mediaRows,
          inventoryAdjRows,
          stockImportRows,
          batches,
          carryforwardRows,
          tickets,
          returns,
          claimRows,
          packingRows,
          promos,
          refundRows,
          priceRows,
          nearExpiryRows,
          mismatchRows,
          adjustmentRows,
          contractRows,
          payoutBundle,
          auditRows,
          exportRows,
          notificationBundle,
          integrationsStatus,
          staffBundle,
          kpis,
          reconcile,
          backupBundle,
          deletionRows,
          recoveryRows,
          reviewRows,
          responseRows,
          tiktokRows,
          recallList,
          qualityBundle,
        ] = await Promise.all([
          listInvites(),
          listStores(),
          listStoreDocuments(50),
          listCodShipments(),
          listOrders(30),
          listSplitShipments(50),
          listCatalogProducts(50),
          listCatalogImportBatches(50),
          listCatalogMedia(50),
          listInventoryAdjustments(50),
          listStockImportBatches(50),
          listSettlementBatches(50),
          listSettlementCarryforwards(50),
          listSupportTickets(50),
          listReturns(50),
          listDeliveryClaims(50),
          listPackingDeadlines(50),
          listPromotions(50),
          listRefunds(50),
          listPriceRequests(50),
          listNearExpiryRequests(50),
          listReconMismatches(50),
          listPaymentAdjustments(50),
          listContracts(50),
          listPayoutRequests(50),
          listAuditEvents(50),
          listExports(50),
          listNotifications(50),
          listIntegrations(),
          listStaffDirectory(50),
          fetchDashboardKpis(),
          fetchPaymentsReconcile(),
          listBackups(50),
          listDeletionRequests(50),
          listRecoveryRequests(50),
          listReviews(50),
          listSupplierResponses(50),
          listTikTokLinks(50),
          listRecalls(50),
          listStoreQuality(50),
        ]);
        setIssuedInvites(invites);
        setStoreDrafts(stores);
        setStoreDocuments(storeDocs);
        setCodShipments(cod);
        setOpsOrders(orders);
        setSplitShipments(splitRows);
        setCatalogProducts(products);
        setImportBatches(importBatchRows);
        setCatalogMedia(mediaRows);
        setInventoryAdjustments(inventoryAdjRows);
        setStockImportBatches(stockImportRows);
        setSettlementBatches(batches);
        setSettlementCarryforwards(carryforwardRows);
        setSupportTickets(tickets);
        setReturnRequests(returns);
        setDeliveryClaims(claimRows);
        setPackingDeadlines(packingRows);
        setPromotions(promos);
        setRefunds(refundRows);
        setPriceRequests(priceRows);
        setNearExpiryRequests(nearExpiryRows);
        setReconMismatches(mismatchRows);
        setPaymentAdjustments(adjustmentRows);
        setContractVersions(contractRows);
        setPayoutRequests(payoutBundle.requests);
        setPayoutAccounts(payoutBundle.accounts);
        setAuditEvents(auditRows);
        setExportRequests(exportRows);
        setNotificationInbox(notificationBundle.inbox);
        setNotificationOutbox(notificationBundle.outbox);
        setIntegrations(integrationsStatus);
        setStaffRoles(staffBundle.roles);
        setStaffDirectory(staffBundle.staff);
        setDashboardKpis(kpis);
        setPaymentsReconcile(reconcile);
        setBackupJobs(backupBundle.jobs);
        setBackupAlerts(backupBundle.alerts);
        setDeletionRequests(deletionRows);
        setRecoveryRequests(recoveryRows);
        setProductReviews(reviewRows);
        setSupplierResponses(responseRows);
        setTiktokLinks(tiktokRows);
        setRecallRows(recallList);
        setQualityEvents(qualityBundle.events);
        setSuspensions(qualityBundle.suspensions);
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
            <h2 id="qa-heading">
              <span lang="en">Dashboard</span>
              {' / '}
              <span lang="lo">ແຜງຄວບຄຸມ</span>
            </h2>
            <p className="lede">
              Live local KPIs from reports (orders, stock, support) plus payment reconcile.
            </p>
            {dashboardNote ? (
              <p className="lede" role="status">
                {dashboardNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Dashboard KPIs">
              {dashboardKpis ? (
                <>
                  <li>
                    source={dashboardKpis.source} · orders={dashboardKpis.orders} · sales=
                    {formatLak(LAK(dashboardKpis.salesLak), locale === 'lo' ? 'lo-LA' : 'en-US')}
                  </li>
                  <li>
                    receipts=
                    {formatLak(
                      LAK(dashboardKpis.paymentReceiptsLak),
                      locale === 'lo' ? 'lo-LA' : 'en-US',
                    )}{' '}
                    · refunds=
                    {formatLak(LAK(dashboardKpis.refundsLak), locale === 'lo' ? 'lo-LA' : 'en-US')} ·
                    settlements=
                    {formatLak(
                      LAK(dashboardKpis.settlementsNetLak),
                      locale === 'lo' ? 'lo-LA' : 'en-US',
                    )}
                  </li>
                  <li>
                    stock on hand={dashboardKpis.stockOnHand} · support open=
                    {dashboardKpis.supportOpen} · breached={dashboardKpis.supportBreached} ·
                    stores suspended={dashboardKpis.storesSuspended}
                  </li>
                </>
              ) : (
                <li>KPIs pending API</li>
              )}
              {paymentsReconcile ? (
                <li>
                  payment reconcile: {paymentsReconcile.ok ? 'ok' : 'mismatch'} · requests=
                  {paymentsReconcile.totalRequests} · mismatches=
                  {paymentsReconcile.mismatchCount}
                </li>
              ) : (
                <li>Reconcile pending API</li>
              )}
            </ul>
            <ul className="roles" aria-label="Viewport checklist">
              <li>Desktop shell</li>
              <li>Tablet sticky nav</li>
              <li>Mobile horizontal nav</li>
              <li>Lo/En overflow wrap</li>
              <li>All {APP_ROLES.length} roles listed</li>
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setDashboardNote('');
                void (async () => {
                  try {
                    const [kpis, reconcile] = await Promise.all([
                      fetchDashboardKpis(),
                      fetchPaymentsReconcile(),
                    ]);
                    setDashboardKpis(kpis);
                    setPaymentsReconcile(reconcile);
                    setDashboardNote(
                      reconcile.ok ? 'Dashboard refreshed · reconcile ok' : 'Reconcile has mismatches',
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'dashboard_refresh_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh dashboard
            </button>
          </section>
          <section aria-labelledby="integrations-heading" id="integrations">
            <h2 id="integrations-heading">
              <span lang="en">Integrations</span>
              {' / '}
              <span lang="lo">ການເຊື່ອມຕໍ່</span>
            </h2>
            <p className="lede">
              Local mode flags + EGO placeholder status (flag OFF, no production traffic).
            </p>
            {integrationsNote ? (
              <p className="lede" role="status">
                {integrationsNote}
              </p>
            ) : null}
            {integrations ? (
              <p className="lede">
                mode={integrations.integrationsMode} · env={integrations.env} · SMS=
                {integrations.smsProvider} · EGO={integrations.egoPosEnabled ? 'ON' : 'OFF'} ·
                traffic={integrations.canSendEgoTraffic ? 'allowed' : 'blocked'}
                {integrations.productionHold ? ' · production hold' : ''}
              </p>
            ) : (
              <p className="lede">Loading integration status…</p>
            )}
            <ul className="roles" aria-label="Integration checklist">
              {(integrations?.checklist ?? []).map((item) => (
                <li key={item.id}>
                  {item.ok ? 'ok' : 'fail'} · {item.label}
                </li>
              ))}
              {!integrations ? <li>Checklist pending API</li> : null}
            </ul>
            <ul className="roles" aria-label="EGO store profiles">
              {(integrations?.stores ?? []).length === 0 ? (
                <li>No active stores / profiles yet — use Ensure EGO profiles</li>
              ) : null}
              {(integrations?.stores ?? []).map((store) => (
                <li key={store.storeId}>
                  {store.storeCode} · {store.egoDisplay} · flag=
                  {store.featureFlagOn ? 'on' : 'off'} · creds=
                  {store.credentialsConfigured ? 'yes' : 'no'}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setIntegrationsNote('');
                void (async () => {
                  try {
                    const result = await mockEnsureEgoProfiles();
                    const next = await listIntegrations();
                    setIntegrations({ ...next, stores: result.stores });
                    setIntegrationsNote(
                      `Ensured ${result.profiles.length} EGO profile(s) (disabled)`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'ego_ensure_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Ensure EGO profiles
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setIntegrations(await listIntegrations());
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'integrations_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh integrations
            </button>
          </section>
          <section aria-labelledby="roles-heading" id="staff">
            <h2 id="roles-heading">
              <span lang="en">Staff & roles</span>
              {' / '}
              <span lang="lo">ພະນັກງານ</span>
            </h2>
            <p className="lede">
              Role catalog, local staff directory, mock lock (non-owner), and unlock (Owner actor).
            </p>
            {staffNote ? <p className="lede">{staffNote}</p> : null}
            <ul className="roles" aria-label="Standard staff roles">
              {(staffRoles.length ? staffRoles : APP_ROLES.map((role) => ({ role, permissions: [] }))).map(
                (row) => (
                  <li key={row.role}>
                    {row.role}
                    {row.permissions.length
                      ? ` · ${row.permissions.length} permissions`
                      : ''}
                  </li>
                ),
              )}
            </ul>
            <ul className="roles" aria-label="Staff directory">
              {staffDirectory.length === 0 ? <li>No staff profiles yet</li> : null}
              {staffDirectory.map((person) => (
                <li key={person.staffProfileId}>
                  {person.displayName} · {person.subject} ·{' '}
                  {person.roles.length ? person.roles.join(', ') : 'no roles'} ·{' '}
                  {person.status}
                  {person.status === 'locked' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setStaffNote('');
                          void (async () => {
                            try {
                              const result = await unlockStaff(person.identityId, {
                                reason: 'BO mock unlock',
                              });
                              if (result.roles) setStaffRoles(result.roles);
                              if (result.staff) setStaffDirectory(result.staff);
                              setStaffNote(
                                `Unlocked ${person.displayName} · ${person.subject}`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'staff_unlock_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Unlock
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
                setStaffNote('');
                void (async () => {
                  try {
                    const result = await mockLockStaff({});
                    if (result.roles) setStaffRoles(result.roles);
                    if (result.staff) setStaffDirectory(result.staff);
                    setStaffNote(
                      `Locked ${result.subject ?? result.identityId.slice(0, 8)}… · ${result.status}`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'staff_lock_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock lock (catalog maker)
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    const result = await listStaffDirectory(50);
                    setStaffRoles(result.roles);
                    setStaffDirectory(result.staff);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'staff_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh staff
            </button>
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
            <p className="lede">
              Create a local store draft (PGlite; not Production). Complete onboarding docs +
              fulfillment to activate. Contracts are immutable versions; payout account changes
              need Owner + 2FA with a 48h hold.
            </p>
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
                    setOnboardNote(`Draft ${store.code} · ${store.status}`);
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
            {onboardNote ? (
              <p className="lede" role="status">
                {onboardNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Store drafts">
              {storeDrafts.length === 0 ? <li>No store drafts yet</li> : null}
              {storeDrafts.map((store) => (
                <li key={store.id}>
                  {store.name} · {store.code} · {store.status}
                  {store.status === 'onboarding' || store.status === 'draft' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setOnboardNote('');
                          void (async () => {
                            try {
                              const types = [
                                'owner_id',
                                'store_info',
                                'bank_account',
                                'contract',
                              ] as const;
                              let lastDocs = storeDocuments;
                              let firstDocId = '';
                              for (const docType of types) {
                                const uploaded = await mockUploadStoreDocument(store.id, {
                                  docType,
                                });
                                lastDocs = uploaded.documents;
                                if (docType === 'owner_id') firstDocId = uploaded.documentId;
                                const verified = await verifyStoreDocument(
                                  uploaded.documentId,
                                  store.id,
                                );
                                if (verified.documents) lastDocs = verified.documents;
                                if (verified.onboarding) setStoreOnboarding(verified.onboarding);
                              }
                              setStoreDocuments(lastDocs);
                              await mockEnsureStoreFulfillment(store.id);
                              if (firstDocId) {
                                const access = await issueStoreDocumentSignedAccess(firstDocId);
                                setOnboardNote(
                                  `Onboarded docs for ${store.code} · token ${access.token.slice(0, 8)}…`,
                                );
                              } else {
                                setOnboardNote(`Onboarded docs for ${store.code}`);
                              }
                              const onboarding = await fetchStoreOnboarding(store.id);
                              setStoreOnboarding(onboarding);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'store_onboard_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Mock complete onboarding
                      </button>{' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setOnboardNote('');
                          void (async () => {
                            try {
                              const result = await activateStore(store.id);
                              if (result.stores) setStoreDrafts(result.stores);
                              if (result.onboarding) setStoreOnboarding(result.onboarding);
                              if (!result.ok) {
                                setOnboardNote(
                                  `Activate blocked: ${result.error ?? 'not_ready'}`,
                                );
                                return;
                              }
                              setOnboardNote(`Activated ${store.code}`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'store_activate_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Activate
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {storeOnboarding ? (
              <p className="lede">
                Checklist · owner {storeOnboarding.checklist.ownerIdOk ? 'ok' : '—'} · info{' '}
                {storeOnboarding.checklist.storeInfoOk ? 'ok' : '—'} · bank{' '}
                {storeOnboarding.checklist.bankAccountOk ? 'ok' : '—'} · contract{' '}
                {storeOnboarding.checklist.contractOk ? 'ok' : '—'} · fulfillment{' '}
                {storeOnboarding.activeFulfillmentCount}
                {storeOnboarding.activation.ok
                  ? ' · ready'
                  : ` · blocked (${storeOnboarding.activation.reason})`}
              </p>
            ) : null}
            <ul className="roles" aria-label="Store documents">
              {storeDocuments.length === 0 ? <li>No store documents yet</li> : null}
              {storeDocuments.slice(0, 12).map((row) => (
                <li key={row.documentId}>
                  {row.status} · {row.docType} · store {row.storeId.slice(0, 8)}…
                  {row.status === 'uploaded' ? (
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
                              const result = await verifyStoreDocument(
                                row.documentId,
                                row.storeId,
                              );
                              if (result.documents) setStoreDocuments(result.documents);
                              if (result.onboarding) setStoreOnboarding(result.onboarding);
                              setOnboardNote(`Verified ${row.docType}`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'store_doc_verify_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Verify
                      </button>
                    </>
                  ) : null}{' '}
                  <button
                    type="button"
                    className="cta"
                    disabled={formBusy}
                    onClick={() => {
                      setFormBusy(true);
                      setFormError('');
                      void (async () => {
                        try {
                          const access = await issueStoreDocumentSignedAccess(row.documentId);
                          setOnboardNote(
                            `Signed access ${access.token.slice(0, 8)}… exp ${access.expiresAt}`,
                          );
                        } catch (err) {
                          setFormError(
                            err instanceof Error ? err.message : 'store_doc_signed_failed',
                          );
                        } finally {
                          setFormBusy(false);
                        }
                      })();
                    }}
                  >
                    Signed URL
                  </button>
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
                    setStoreDrafts(await listStores());
                    setStoreDocuments(await listStoreDocuments(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'stores_refresh_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh stores & docs
            </button>
            {payoutNote ? (
              <p className="lede" role="status">
                {payoutNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Store contracts">
              {contractVersions.length === 0 ? <li>No contract versions yet</li> : null}
              {contractVersions.map((row) => (
                <li key={row.contractId}>
                  v{row.versionNo} · {row.revenueModel} · {row.settlementCadence} · store{' '}
                  {row.storeId.slice(0, 8)}… · from {row.effectiveFrom}
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
                setPayoutNote('');
                void (async () => {
                  try {
                    const result = await mockCreateContract({ commissionBps: 1000 });
                    setContractVersions(result.contracts);
                    setPayoutNote(`Contract v${result.versionNo} created`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'contract_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create contract
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setContractVersions(await listContracts(50));
                    const payouts = await listPayoutRequests(50);
                    setPayoutRequests(payouts.requests);
                    setPayoutAccounts(payouts.accounts);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'stores_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh contracts & payouts
            </button>
            <ul className="roles" aria-label="Payout accounts">
              {payoutAccounts.length === 0 ? <li>No payout accounts yet</li> : null}
              {payoutAccounts.map((row) => (
                <li key={row.versionId}>
                  {row.status} · {row.bankName} ···{row.accountNumberLast4} ·{' '}
                  {row.accountHolder}
                  {row.payoutHoldUntil ? ` · hold until ${row.payoutHoldUntil}` : ''}
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
            <p className="lede">
              Active products from local catalog API (with available qty). Preview/commit CSV-style
              import batches (prohibited categories rejected). Private media upload + signed URL for
              ops review.
            </p>
            {catalogNote ? (
              <p className="lede" role="status">
                {catalogNote}
              </p>
            ) : null}
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
                    setImportBatches(await listCatalogImportBatches(50));
                    setCatalogMedia(await listCatalogMedia(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'catalog_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh catalog
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                setCatalogNote('');
                void (async () => {
                  try {
                    const result = await previewCatalogImport({
                      idempotencyKey: `bo-import-${Date.now()}`,
                    });
                    setImportBatches(result.batches);
                    setCatalogNote(
                      `Preview ${result.batchId.slice(0, 8)}… valid=${result.report.valid} invalid=${result.report.invalid}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'catalog_import_preview_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock import preview
            </button>
            <ul className="roles" aria-label="Catalog import batches">
              {importBatches.length === 0 ? <li>No import batches yet</li> : null}
              {importBatches.map((row) => (
                <li key={row.batchId}>
                  {row.status} · {row.idempotencyKey} · valid{' '}
                  {row.previewReport?.valid ?? 0}/invalid {row.previewReport?.invalid ?? 0} ·{' '}
                  {row.batchId.slice(0, 8)}…
                  {row.status === 'preview' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setCatalogNote('');
                          void (async () => {
                            try {
                              const result = await commitCatalogImport(row.batchId);
                              if (result.batches) setImportBatches(result.batches);
                              setCatalogProducts(await listCatalogProducts(50));
                              setCatalogNote(
                                `Committed ${row.batchId.slice(0, 8)}… (${result.status})`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'catalog_import_commit_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Commit
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
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
                  ) : null}{' '}
                  <button
                    type="button"
                    className="cta"
                    disabled={formBusy}
                    onClick={() => {
                      setFormBusy(true);
                      setFormError('');
                      setCatalogNote('');
                      void (async () => {
                        try {
                          const result = await mockUploadCatalogMedia({ productId: p.id });
                          setCatalogMedia(result.media);
                          setCatalogNote(`Uploaded media ${result.mediaId.slice(0, 8)}…`);
                        } catch (err) {
                          setFormError(
                            err instanceof Error ? err.message : 'catalog_media_upload_failed',
                          );
                        } finally {
                          setFormBusy(false);
                        }
                      })();
                    }}
                  >
                    Upload media
                  </button>
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Catalog media">
              {catalogMedia.length === 0 ? <li>No catalog media yet</li> : null}
              {catalogMedia.map((row) => (
                <li key={row.mediaId}>
                  {row.validationStatus} · {row.mediaType} · {row.mimeType} ·{' '}
                  {row.mediaId.slice(0, 8)}…
                  {row.productId ? ` · product ${row.productId.slice(0, 8)}…` : ''}{' '}
                  <button
                    type="button"
                    className="cta"
                    disabled={formBusy}
                    onClick={() => {
                      setFormBusy(true);
                      setFormError('');
                      setCatalogNote('');
                      void (async () => {
                        try {
                          const access = await issueCatalogMediaSignedUrl(row.mediaId);
                          setCatalogNote(
                            `Media signed ${access.token.slice(0, 8)}… exp ${access.expiresAt}`,
                          );
                        } catch (err) {
                          setFormError(
                            err instanceof Error ? err.message : 'catalog_media_signed_failed',
                          );
                        } finally {
                          setFormBusy(false);
                        }
                      })();
                    }}
                  >
                    Signed URL
                  </button>
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
              Lot balances for a selected variant (use Stock on a catalog row). Mock receive adds
              units; adjust applies maker-checker in one shot. Preview/commit stock import batches
              apply deltas as import ledger txs.
            </p>
            {inventoryNote ? (
              <p className="lede" role="status">
                {inventoryNote}
              </p>
            ) : null}
            {stockDetail ? (
              <ul className="roles" aria-label="Stock balances">
                <li>
                  Variant {stockDetail.variantId.slice(0, 8)}… · available {stockDetail.availableQty}
                </li>
                {stockDetail.balances.map((b) => (
                  <li key={b.balanceId}>
                    {b.lotCode ?? b.lotId.slice(0, 8)} · on hand {b.onHand} · reserved {b.reserved} ·
                    avail {b.available}
                    {b.expiryDate ? ` · exp ${b.expiryDate}` : ''}{' '}
                    <button
                      type="button"
                      className="cta"
                      disabled={formBusy}
                      onClick={() => {
                        setFormBusy(true);
                        setFormError('');
                        setInventoryNote('');
                        void (async () => {
                          try {
                            const result = await opsReceiveStock({
                              balanceId: b.balanceId,
                              quantity: 5,
                            });
                            if (result.stock) setStockDetail(result.stock);
                            if (result.adjustments) setInventoryAdjustments(result.adjustments);
                            setInventoryNote(
                              `Received +5 on ${b.lotCode ?? b.balanceId.slice(0, 8)}… · on hand ${result.onHand ?? ''}`,
                            );
                          } catch (err) {
                            setFormError(
                              err instanceof Error ? err.message : 'inventory_receive_failed',
                            );
                          } finally {
                            setFormBusy(false);
                          }
                        })();
                      }}
                    >
                      Receive +5
                    </button>{' '}
                    <button
                      type="button"
                      className="cta"
                      disabled={formBusy}
                      onClick={() => {
                        setFormBusy(true);
                        setFormError('');
                        setInventoryNote('');
                        void (async () => {
                          try {
                            const result = await opsAdjustStock({
                              balanceId: b.balanceId,
                              delta: -1,
                              reason: 'BO mock cycle count',
                            });
                            if (result.stock) setStockDetail(result.stock);
                            if (result.adjustments) setInventoryAdjustments(result.adjustments);
                            setInventoryNote(
                              `Adjusted −1 on ${b.lotCode ?? b.balanceId.slice(0, 8)}… · on hand ${result.onHand ?? ''}`,
                            );
                          } catch (err) {
                            setFormError(
                              err instanceof Error ? err.message : 'inventory_adjust_failed',
                            );
                          } finally {
                            setFormBusy(false);
                          }
                        })();
                      }}
                    >
                      Adjust −1
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lede">No variant selected yet.</p>
            )}
            <ul className="roles" aria-label="Inventory adjustments">
              {inventoryAdjustments.length === 0 ? <li>No inventory adjustments yet</li> : null}
              {inventoryAdjustments.map((row) => (
                <li key={row.adjustmentId}>
                  {row.status} · Δ {row.delta} · {row.reason} · bal {row.balanceId.slice(0, 8)}…
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Stock import batches">
              {stockImportBatches.length === 0 ? <li>No stock import batches yet</li> : null}
              {stockImportBatches.map((row) => (
                <li key={row.batchId}>
                  {row.status} · {row.idempotencyKey} · Δ total{' '}
                  {row.previewReport?.differenceTotal ?? 0} · {row.batchId.slice(0, 8)}…
                  {row.status === 'preview' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setInventoryNote('');
                          void (async () => {
                            try {
                              const result = await commitStockImport(row.batchId);
                              if (result.batches) setStockImportBatches(result.batches);
                              if (stockDetail?.variantId) {
                                setStockDetail(await fetchVariantStock(stockDetail.variantId));
                              }
                              setInventoryNote(
                                `Committed stock import ${row.batchId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'stock_import_commit_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Commit import
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
                setInventoryNote('');
                void (async () => {
                  try {
                    const result = await previewStockImport({
                      idempotencyKey: `bo-stock-${Date.now()}`,
                      storeId: stockDetail?.balances[0]?.storeId,
                      rows: stockDetail?.balances[0]
                        ? [
                            {
                              variantId: stockDetail.variantId,
                              lotId: stockDetail.balances[0].lotId,
                              onHand: stockDetail.balances[0].onHand + 5,
                            },
                          ]
                        : undefined,
                    });
                    setStockImportBatches(result.batches);
                    setInventoryNote(
                      `Preview ${result.batchId.slice(0, 8)}… Δ=${result.report.differenceTotal ?? 0}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'stock_import_preview_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock stock import preview
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setInventoryAdjustments(await listInventoryAdjustments(50));
                    setStockImportBatches(await listStockImportBatches(50));
                    if (stockDetail?.variantId) {
                      setStockDetail(await fetchVariantStock(stockDetail.variantId));
                    }
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'inventory_refresh_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh inventory
            </button>
          </section>
          <section aria-labelledby="orders-heading" id="orders">
            <h2 id="orders-heading">
              <span lang="en">Orders</span>
              {' / '}
              <span lang="lo">ອໍເດີ</span>
            </h2>
            <p className="lede">
              Recent parent orders from local API (PGlite mock). Request split shipments that need
              Owner approval (maker≠approver).
            </p>
            {ordersNote ? (
              <p className="lede" role="status">
                {ordersNote}
              </p>
            ) : null}
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
                    setSplitShipments(await listSplitShipments(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'orders_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh orders
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                setOrdersNote('');
                void (async () => {
                  try {
                    const result = await mockRequestSplitShipment({});
                    if (result.requests) setSplitShipments(result.requests);
                    setOrdersNote(
                      `Split request ${result.requestId.slice(0, 8)}… · shipment ${result.shipmentId.slice(0, 8)}…`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'split_request_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock split request
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
            <ul className="roles" aria-label="Split shipment requests">
              {splitShipments.length === 0 ? <li>No split shipment requests yet</li> : null}
              {splitShipments.map((row) => (
                <li key={row.requestId}>
                  {row.status} · {row.orderNumber} · items {row.itemCount} ·{' '}
                  {row.requestId.slice(0, 8)}…
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
                          setOrdersNote('');
                          void (async () => {
                            try {
                              const result = await approveSplitShipment(
                                row.requestId,
                                row.shipmentId ?? undefined,
                              );
                              if (result.requests) setSplitShipments(result.requests);
                              setOrdersNote(`Approved split ${row.requestId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'split_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve split
                      </button>
                    </>
                  ) : null}
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
              Orders still use Confirm / Advance / Deliver. Here: packing SLA deadlines and
              lost/damaged delivery claims.
            </p>
            {fulfillmentNote ? (
              <p className="lede" role="status">
                {fulfillmentNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Packing deadlines">
              {packingDeadlines.length === 0 ? <li>No packing deadlines yet</li> : null}
              {packingDeadlines.map((row) => (
                <li key={row.packingDeadlineId}>
                  {row.late ? 'LATE' : 'ok'} · due {row.dueAt.slice(0, 16)} · child{' '}
                  {row.childOrderId.slice(0, 8)}… · {row.childStatus}
                  {row.packedAt ? ` · packed ${row.packedAt.slice(0, 16)}` : ' · unpacked'}
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
                setFulfillmentNote('');
                void (async () => {
                  try {
                    const result = await mockEvaluatePackingDeadline({ hoursAgo: 25 });
                    if (result.deadlines) setPackingDeadlines(result.deadlines);
                    setFulfillmentNote(
                      `Evaluated packing ${result.childOrderId.slice(0, 8)}… · late=${String(result.late)}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'packing_evaluate_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock evaluate packing SLA
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setPackingDeadlines(await listPackingDeadlines(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'packing_deadlines_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh packing
            </button>
            <ul className="roles" aria-label="Delivery claims">
              {deliveryClaims.length === 0 ? <li>No delivery claims yet</li> : null}
              {deliveryClaims.map((claim) => (
                <li key={claim.claimId}>
                  {claim.claimType} · {claim.status} · liability {claim.liabilityParty ?? '—'} ·
                  delivery {claim.deliveryStatus} · child {claim.childOrderId.slice(0, 8)}…
                  {claim.status === 'open' || claim.status === 'platform_coordinating' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setFulfillmentNote('');
                          void (async () => {
                            try {
                              const result = await resolveDeliveryClaim(claim.claimId, {
                                status: 'resolved',
                                notes: 'BO mock resolve',
                              });
                              if (result.claims) setDeliveryClaims(result.claims);
                              setFulfillmentNote(
                                `Resolved claim ${claim.claimId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'delivery_claim_resolve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Resolve
                      </button>{' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setFulfillmentNote('');
                          void (async () => {
                            try {
                              const result = await resolveDeliveryClaim(claim.claimId, {
                                status: 'rejected',
                                notes: 'BO mock reject',
                              });
                              if (result.claims) setDeliveryClaims(result.claims);
                              setFulfillmentNote(
                                `Rejected claim ${claim.claimId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'delivery_claim_reject_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Reject
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
                setFulfillmentNote('');
                void (async () => {
                  try {
                    const result = await mockOpenDeliveryClaim({ claimType: 'damaged' });
                    if (result.claims) setDeliveryClaims(result.claims);
                    setFulfillmentNote(
                      `Opened claim ${result.claimId.slice(0, 8)}… · ${result.status ?? 'platform_coordinating'}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'delivery_claim_open_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock open claim
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setDeliveryClaims(await listDeliveryClaims(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'delivery_claims_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh claims
            </button>
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
              Local settlement batches — create draft, submit, approve (maker-checker), hold a line,
              dispute, or record negative carryforward + collection request.
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
                  {batch.heldLak > 0 ? ` · held ${formatLak(LAK(batch.heldLak))}` : ''}
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
                              const result = await holdSettlementLine(batch.batchId, {
                                reason: 'BO mock hold',
                              });
                              if (result.batches) setSettlementBatches(result.batches);
                              setSettlementNote(
                                `Held line on ${batch.batchId.slice(0, 8)}… · child ${result.childOrderId?.slice(0, 8) ?? ''}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'settlement_hold_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Hold line
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
            <ul className="roles" aria-label="Settlement carryforwards">
              {settlementCarryforwards.length === 0 ? (
                <li>No negative carryforwards yet</li>
              ) : null}
              {settlementCarryforwards.map((row) => (
                <li key={row.carryforwardId}>
                  {row.status} · {row.storeName} · {formatLak(LAK(row.amountLak))}
                  {row.collectionRequestId
                    ? ` · collect ${row.collectionStatus ?? 'open'} ${row.collectionRequestId.slice(0, 8)}…`
                    : ''}
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
                setFormError('');
                setSettlementNote('');
                void (async () => {
                  try {
                    const result = await mockSettlementCarryforward({
                      storeId: settlementBatches[0]?.storeId,
                      sourceBatchId: settlementBatches[0]?.batchId,
                      amountLak: -25000,
                    });
                    if (result.carryforwards) setSettlementCarryforwards(result.carryforwards);
                    setSettlementNote(
                      `Carryforward ${result.carryforwardId.slice(0, 8)}… · ${formatLak(LAK(result.amountLak ?? -25000))}` +
                        (result.collectionRequestId
                          ? ` · collect ${result.collectionRequestId.slice(0, 8)}…`
                          : ''),
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'settlement_carryforward_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock carryforward (−25k)
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
                    setSettlementCarryforwards(await listSettlementCarryforwards(50));
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
              Local support tickets — mock create, staff reply, preliminary resolve, and SLA
              evaluate/escalate.
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
                  {ticket.escalatedAt ? ' · ESCALATED' : ''}
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
                setFormError('');
                setSupportNote('');
                void (async () => {
                  try {
                    const result = await mockEvaluateSupportSla({
                      now: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
                    });
                    if (result.tickets) setSupportTickets(result.tickets);
                    setSupportNote(
                      `SLA ${result.ticketId.slice(0, 8)}… · escalated=${String(result.escalated)} · ${result.breaches.join(',') || 'none'}`,
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'support_sla_evaluate_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock evaluate SLA
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
              Local refund, price, near-expiry, payout, and payment-adjustment approvals — mock
              create, approve (maker-checker; below-cost / payouts need Owner + 2FA; payouts get
              48h hold), then mock-pay refunds. Resolve recon mismatches into pending adjustments.
            </p>
            {refundNote ? (
              <p className="lede" role="status">
                {refundNote}
              </p>
            ) : null}
            {pricingNote ? (
              <p className="lede" role="status">
                {pricingNote}
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
            <ul className="roles" aria-label="Price change requests">
              {priceRequests.length === 0 ? <li>No price requests yet</li> : null}
              {priceRequests.map((row) => (
                <li key={row.requestId}>
                  {row.status} · sell {formatLak(LAK(row.sellingPriceLak))} / cost{' '}
                  {formatLak(LAK(row.costLak))}
                  {row.belowCost ? ' · below-cost' : ''} · variant {row.variantId.slice(0, 8)}…
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
                          setPricingNote('');
                          void (async () => {
                            try {
                              const result = await approvePriceRequest(row.requestId);
                              if (result.requests) setPriceRequests(result.requests);
                              setPricingNote(`Approved price ${row.requestId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'price_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve price
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
                setPricingNote('');
                void (async () => {
                  try {
                    const result = await mockProposePrice({ sellingPriceLak: 9000 });
                    setPriceRequests(result.requests);
                    setPricingNote(`Proposed ${result.requestId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'price_propose_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock propose price
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setFormError('');
                setPricingNote('');
                void (async () => {
                  try {
                    const result = await mockProposePrice({ belowCost: true });
                    setPriceRequests(result.requests);
                    setPricingNote(
                      `Below-cost ${result.requestId.slice(0, 8)}… (Owner+2FA)`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'price_propose_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock below-cost price
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setPriceRequests(await listPriceRequests(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'pricing_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh prices
            </button>
            <ul className="roles" aria-label="Near-expiry discount requests">
              {nearExpiryRequests.length === 0 ? <li>No near-expiry requests yet</li> : null}
              {nearExpiryRequests.map((row) => (
                <li key={row.requestId}>
                  {row.status} · {formatLak(LAK(row.proposedSellingPriceLak))} ·{' '}
                  {row.reason} · variant {row.variantId.slice(0, 8)}…
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
                          setPricingNote('');
                          void (async () => {
                            try {
                              const result = await approveNearExpiryRequest(row.requestId);
                              if (result.requests) setNearExpiryRequests(result.requests);
                              setPricingNote(
                                `Approved near-expiry ${row.requestId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'near_expiry_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve near-expiry
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
                setPricingNote('');
                void (async () => {
                  try {
                    const result = await mockProposeNearExpiry({
                      proposedSellingPriceLak: 3000,
                      reason: 'BO mock near-expiry clearance',
                    });
                    setNearExpiryRequests(result.requests);
                    setPricingNote(
                      `Near-expiry ${result.requestId.slice(0, 8)}…` +
                        (result.linkedLotId
                          ? ` linked lot ${result.linkedLotId.slice(0, 8)}…`
                          : ''),
                    );
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'near_expiry_propose_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock near-expiry discount
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setNearExpiryRequests(await listNearExpiryRequests(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'near_expiry_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh near-expiry
            </button>
            {payoutNote ? (
              <p className="lede" role="status">
                {payoutNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Payout change requests">
              {payoutRequests.length === 0 ? <li>No payout change requests yet</li> : null}
              {payoutRequests.map((row) => (
                <li key={row.requestId}>
                  {row.status} · {row.bankName} ···{row.accountNumberLast4} · store{' '}
                  {row.storeId.slice(0, 8)}…
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
                          setPayoutNote('');
                          void (async () => {
                            try {
                              const result = await approvePayoutRequest(row.requestId);
                              if (result.requests) setPayoutRequests(result.requests);
                              if (result.accounts) setPayoutAccounts(result.accounts);
                              setPayoutNote(
                                `Approved payout ${row.requestId.slice(0, 8)}… hold ${result.holdUntil ?? ''}`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'payout_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve payout
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
                setPayoutNote('');
                void (async () => {
                  try {
                    const result = await mockProposePayout({
                      bankName: 'BCEL',
                      accountHolder: 'BO Mock Payout',
                    });
                    setPayoutRequests(result.requests);
                    setPayoutAccounts(result.accounts);
                    setPayoutNote(`Proposed payout ${result.requestId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'payout_propose_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock propose payout
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    const payouts = await listPayoutRequests(50);
                    setPayoutRequests(payouts.requests);
                    setPayoutAccounts(payouts.accounts);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'payouts_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh payouts
            </button>
            {adjustNote ? (
              <p className="lede" role="status">
                {adjustNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Payment recon mismatches">
              {reconMismatches.length === 0 ? <li>No recon mismatches yet</li> : null}
              {reconMismatches.map((row) => (
                <li key={row.mismatchId}>
                  {row.status} · {row.mismatchType} · expected {formatLak(LAK(row.expectedLak))} /
                  actual {formatLak(LAK(row.actualLak))} · ref {row.referenceId.slice(0, 8)}…
                  {row.status === 'open' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setFormError('');
                          setAdjustNote('');
                          void (async () => {
                            try {
                              const result = await resolveReconMismatch(row.mismatchId, {
                                note: 'BO mock mismatch resolve',
                                createAdjustment: true,
                              });
                              if (result.mismatches) setReconMismatches(result.mismatches);
                              if (result.adjustments) setPaymentAdjustments(result.adjustments);
                              setAdjustNote(
                                `Resolved ${row.mismatchId.slice(0, 8)}…` +
                                  (result.adjustmentId
                                    ? ` → adj ${result.adjustmentId.slice(0, 8)}…`
                                    : ''),
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'mismatch_resolve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Resolve → adjustment
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
                setAdjustNote('');
                void (async () => {
                  try {
                    const result = await mockCreateMismatch({
                      expectedLak: 10000,
                      actualLak: 9500,
                      mismatchType: 'bank',
                    });
                    setReconMismatches(result.mismatches);
                    setAdjustNote(`Opened mismatch ${result.mismatchId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'mismatch_create_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create mismatch
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setReconMismatches(await listReconMismatches(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'mismatches_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh mismatches
            </button>
            <ul className="roles" aria-label="Payment adjustments">
              {paymentAdjustments.length === 0 ? <li>No payment adjustments yet</li> : null}
              {paymentAdjustments.map((row) => (
                <li key={row.adjustmentId}>
                  {row.status} · {formatLak(LAK(row.amountLak))} · {row.reason} · maker{' '}
                  {row.makerIdentityId.slice(0, 8)}…
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
                          setAdjustNote('');
                          void (async () => {
                            try {
                              const result = await approvePaymentAdjustment(row.adjustmentId);
                              if (result.adjustments) setPaymentAdjustments(result.adjustments);
                              setAdjustNote(
                                `Approved adjustment ${row.adjustmentId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'adjustment_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve adjustment
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
                    setPaymentAdjustments(await listPaymentAdjustments(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'adjustments_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh adjustments
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
          <section aria-labelledby="backups-heading" id="backups">
            <h2 id="backups-heading">
              <span lang="en">Backups</span>
              {' / '}
              <span lang="lo">ສຳຮອງ</span>
            </h2>
            <p className="lede">
              Local encrypted backup jobs — mock run, checksum verify, restore drill (no cloud
              upload).
            </p>
            {backupNote ? (
              <p className="lede" role="status">
                {backupNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Backup jobs">
              {backupJobs.length === 0 ? <li>No backup jobs yet</li> : null}
              {backupJobs.map((job) => (
                <li key={job.jobId}>
                  {job.status} · {job.jobType} · {job.jobId.slice(0, 8)}…
                  {job.status === 'completed' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setBackupNote('');
                          void (async () => {
                            try {
                              const result = await verifyBackup(job.jobId);
                              if (result.jobs) setBackupJobs(result.jobs);
                              setBackupNote(`Verified ${job.jobId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'backup_verify_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Verify
                      </button>{' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setBackupNote('');
                          void (async () => {
                            try {
                              const result = await restoreDrillBackup(job.jobId);
                              if (result.jobs) setBackupJobs(result.jobs);
                              setBackupNote(`Restore drill ok for ${job.jobId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'backup_drill_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Restore drill
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Backup alerts">
              {backupAlerts.length === 0 ? <li>No backup alerts</li> : null}
              {backupAlerts.map((alert) => (
                <li key={alert.alertId}>
                  {alert.message} · job {alert.jobId.slice(0, 8)}…
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setBackupNote('');
                void (async () => {
                  try {
                    const result = await mockRunBackup({ jobType: 'daily_critical' });
                    setBackupJobs(result.jobs);
                    setBackupAlerts(result.alerts);
                    setBackupNote(`Ran ${result.status} job ${result.jobId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'backup_run_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock daily backup
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setBackupNote('');
                void (async () => {
                  try {
                    const result = await mockRunBackup({
                      jobType: 'pre_migration',
                      fail: true,
                    });
                    setBackupJobs(result.jobs);
                    setBackupAlerts(result.alerts);
                    setBackupNote(`Simulated failure ${result.jobId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'backup_run_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Simulate failure
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    const result = await listBackups(50);
                    setBackupJobs(result.jobs);
                    setBackupAlerts(result.alerts);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'backups_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh backups
            </button>
          </section>
          <section aria-labelledby="privacy-heading" id="privacy">
            <h2 id="privacy-heading">
              <span lang="en">Privacy</span>
              {' / '}
              <span lang="lo">ຄວາມເປັນສ່ວນຕົວ</span>
            </h2>
            <p className="lede">
              Account deletion requests — approve anonymizes profile/phone; orders retained.
              Recovery queue lists encrypted private document submissions.
            </p>
            {privacyNote ? (
              <p className="lede" role="status">
                {privacyNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Deletion requests">
              {deletionRequests.length === 0 ? <li>No deletion requests</li> : null}
              {deletionRequests.map((row) => (
                <li key={row.requestId}>
                  {row.status} · {row.requestId.slice(0, 8)}… · customer{' '}
                  {row.customerIdentityId.slice(0, 8)}…
                  {row.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setPrivacyNote('');
                          void (async () => {
                            try {
                              const result = await approveDeletionRequest(row.requestId);
                              if (result.requests) setDeletionRequests(result.requests);
                              setPrivacyNote(
                                `Anonymized ${row.requestId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'deletion_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve & anonymize
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
                    setDeletionRequests(await listDeletionRequests(50));
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'deletion_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh deletion queue
            </button>
            <ul className="roles" aria-label="Recovery requests">
              {recoveryRequests.length === 0 ? <li>No recovery requests</li> : null}
              {recoveryRequests.map((row) => (
                <li key={row.requestId}>
                  {row.status} · {row.claimedPhoneE164} ·{' '}
                  {row.documentEncrypted ? 'encrypted' : 'plain'} ·{' '}
                  {row.documentStorageKey}
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
                    setRecoveryRequests(await listRecoveryRequests(50));
                    setPrivacyNote('Recovery queue refreshed');
                  } catch (err) {
                    setFormError(
                      err instanceof Error ? err.message : 'recovery_list_failed',
                    );
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh recovery queue
            </button>
          </section>
          <section aria-labelledby="content-heading" id="content">
            <h2 id="content-heading">
              <span lang="en">Content</span>
              {' / '}
              <span lang="lo">ເນື້ອຫາ</span>
            </h2>
            <p className="lede">
              Product reviews and TikTok links — mock seed verified reviews; edit window 7d;
              supplier replies need approval; moderate pending TikTok submissions.
            </p>
            {contentNote ? (
              <p className="lede" role="status">
                {contentNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Product reviews">
              {productReviews.length === 0 ? <li>No reviews yet</li> : null}
              {productReviews.map((row) => (
                <li key={row.reviewId}>
                  ★{row.rating} · {row.status}
                  {row.verifiedPurchase ? ' · verified' : ''}
                  {row.bodyEn ? ` — ${row.bodyEn}` : ''} · {row.reviewId.slice(0, 8)}…
                  {' '}
                  <button
                    type="button"
                    className="cta"
                    disabled={formBusy}
                    onClick={() => {
                      setFormBusy(true);
                      setContentNote('');
                      void (async () => {
                        try {
                          const result = await submitSupplierResponse(
                            row.reviewId,
                            'Thanks for shopping with us!',
                          );
                          if (result.responses) setSupplierResponses(result.responses);
                          else setSupplierResponses(await listSupplierResponses(50));
                          setContentNote(
                            `Supplier reply ${result.responseId.slice(0, 8)}… (${result.status})`,
                          );
                        } catch (err) {
                          setFormError(
                            err instanceof Error ? err.message : 'supplier_response_failed',
                          );
                        } finally {
                          setFormBusy(false);
                        }
                      })();
                    }}
                  >
                    Supplier reply
                  </button>
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Supplier responses">
              {supplierResponses.length === 0 ? <li>No supplier responses yet</li> : null}
              {supplierResponses.map((row) => (
                <li key={row.responseId}>
                  {row.status} · review {row.reviewId.slice(0, 8)}… — {row.body}
                  {row.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setContentNote('');
                          void (async () => {
                            try {
                              const result = await approveSupplierResponse(row.responseId);
                              if (result.responses) setSupplierResponses(result.responses);
                              setContentNote(
                                `Approved reply ${row.responseId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error
                                  ? err.message
                                  : 'supplier_response_approve_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve reply
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="TikTok links">
              {tiktokLinks.length === 0 ? <li>No TikTok links yet</li> : null}
              {tiktokLinks.map((link) => (
                <li key={link.linkId}>
                  {link.status} · {link.submittedByType} · {link.url}
                  {link.status === 'pending' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setContentNote('');
                          void (async () => {
                            try {
                              const result = await moderateTikTokLink(link.linkId, true);
                              if (result.links) setTiktokLinks(result.links);
                              setContentNote(`Published ${link.linkId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'tiktok_moderate_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Approve
                      </button>{' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setContentNote('');
                          void (async () => {
                            try {
                              const result = await moderateTikTokLink(link.linkId, false);
                              if (result.links) setTiktokLinks(result.links);
                              setContentNote(`Rejected ${link.linkId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'tiktok_moderate_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Reject
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
                setContentNote('');
                void (async () => {
                  try {
                    const result = await mockCreateReview({
                      rating: 5,
                      bodyEn: 'BO mock review',
                    });
                    setProductReviews(result.reviews);
                    setContentNote(`Created review ${result.reviewId.slice(0, 8)}…`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'review_mock_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock create review
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setContentNote('');
                void (async () => {
                  try {
                    const result = await mockSubmitTikTokLink({ as: 'supplier' });
                    setTiktokLinks(result.links);
                    setContentNote(`Submitted TikTok ${result.linkId.slice(0, 8)}… (${result.status})`);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'tiktok_submit_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock submit TikTok
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setProductReviews(await listReviews(50));
                    setSupplierResponses(await listSupplierResponses(50));
                    setTiktokLinks(await listTikTokLinks(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'content_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh content
            </button>
          </section>
          <section aria-labelledby="recalls-heading" id="recalls">
            <h2 id="recalls-heading">
              <span lang="en">Recalls</span>
              {' / '}
              <span lang="lo">ເອີ້ນຄືນ</span>
            </h2>
            <p className="lede">
              Product recalls archive listings, track affected orders, and mark customer contact
              complete (store bears cost).
            </p>
            {recallNote ? (
              <p className="lede" role="status">
                {recallNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Product recalls">
              {recallRows.length === 0 ? <li>No recalls yet</li> : null}
              {recallRows.map((row) => (
                <li key={row.recallId}>
                  {row.status} · affected {row.affectedCount} · pending {row.pendingCount} ·{' '}
                  {row.reason} · {row.recallId.slice(0, 8)}…
                  {row.status === 'active' && row.pendingCount > 0 ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setRecallNote('');
                          void (async () => {
                            try {
                              const result = await contactRecallAffected(row.recallId);
                              if (result.recalls) setRecallRows(result.recalls);
                              setRecallNote(
                                result.complete
                                  ? `Completed ${row.recallId.slice(0, 8)}…`
                                  : `Contacted order on ${row.recallId.slice(0, 8)}…`,
                              );
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'recall_contact_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Contact next
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
                setRecallNote('');
                void (async () => {
                  try {
                    const result = await mockStartRecall({ reason: 'BO mock recall' });
                    setRecallRows(result.recalls);
                    setRecallNote(
                      `Started ${result.recallId.slice(0, 8)}… (${result.affectedCount} affected)`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'recall_start_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock start recall
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    setRecallRows(await listRecalls(50));
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'recalls_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh recalls
            </button>
          </section>
          <section aria-labelledby="quality-heading" id="quality">
            <h2 id="quality-heading">
              <span lang="en">Quality</span>
              {' / '}
              <span lang="lo">ຄຸນນະພາບ</span>
            </h2>
            <p className="lede">
              Store quality events and suspensions — mock threshold events and reactivate with
              evidence.
            </p>
            {qualityNote ? (
              <p className="lede" role="status">
                {qualityNote}
              </p>
            ) : null}
            <ul className="roles" aria-label="Suspensions">
              {suspensions.length === 0 ? <li>No suspensions</li> : null}
              {suspensions.map((row) => (
                <li key={row.suspensionId}>
                  {row.active ? 'active' : 'cleared'} · {row.reasonCode} · store{' '}
                  {row.storeId.slice(0, 8)}…
                  {row.active ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cta"
                        disabled={formBusy}
                        onClick={() => {
                          setFormBusy(true);
                          setQualityNote('');
                          void (async () => {
                            try {
                              const result = await reactivateStore(
                                row.storeId,
                                'hired packer and retrained staff',
                              );
                              if (result.events) setQualityEvents(result.events);
                              if (result.suspensions) setSuspensions(result.suspensions);
                              setQualityNote(`Reactivated ${row.storeId.slice(0, 8)}…`);
                            } catch (err) {
                              setFormError(
                                err instanceof Error ? err.message : 'reactivate_failed',
                              );
                            } finally {
                              setFormBusy(false);
                            }
                          })();
                        }}
                      >
                        Reactivate
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <ul className="roles" aria-label="Quality events">
              {qualityEvents.length === 0 ? <li>No quality events</li> : null}
              {qualityEvents.slice(0, 12).map((row) => (
                <li key={row.eventId}>
                  {row.eventType} · store {row.storeId.slice(0, 8)}…
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                setQualityNote('');
                void (async () => {
                  try {
                    const result = await mockQualityEvent({
                      eventType: 'slow_response_or_pack',
                      count: 5,
                    });
                    setQualityEvents(result.events);
                    setSuspensions(result.suspensions);
                    setQualityNote(
                      result.result?.suspended
                        ? `Suspended ${result.storeId.slice(0, 8)}… (${result.result.reason})`
                        : `Recorded events for ${result.storeId.slice(0, 8)}…`,
                    );
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'quality_event_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Mock threshold (×5)
            </button>{' '}
            <button
              type="button"
              className="cta"
              disabled={formBusy}
              onClick={() => {
                setFormBusy(true);
                void (async () => {
                  try {
                    const result = await listStoreQuality(50);
                    setQualityEvents(result.events);
                    setSuspensions(result.suspensions);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : 'quality_list_failed');
                  } finally {
                    setFormBusy(false);
                  }
                })();
              }}
            >
              Refresh quality
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
                  'backups',
                  'privacy',
                  'content',
                  'recalls',
                  'quality',
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
