import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { BRAND_NAME, LAK, formatLak } from '@bombee/shared';

import { BRANDS, CATEGORIES, PRODUCTS, STORES, productTitle, type CatalogProduct, type Locale } from './data/catalog';
import { cartTotals, groupCartByStore, loadCart, saveCart, type CartLine } from './lib/cart';
import { evaluateCodUx, parentChildSummary } from './lib/checkout';
import { assertOnlineForMutation, isSensitiveRoute, readNetworkStatus } from './lib/offline';
import { requestCustomerOtp, verifyCustomerOtp, fetchSessionMe, logoutSession } from './lib/authApi';
import { loadCatalogProducts } from './lib/catalogApi';
import {
  cancelOrderBeforeHandoff,
  checkoutLocalCart,
  fetchOrderView,
  mockAdvanceFulfillment,
  mockDeliverFulfillment,
} from './lib/checkoutApi';
import {
  confirmChildrenMock,
  createCodPayment,
  createQrPayment,
  fetchPaymentStatus,
  mockConfirmPayment,
  type QrPayment,
} from './lib/paymentApi';

type Route =
  | 'home'
  | 'search'
  | 'category'
  | 'store'
  | 'brand'
  | 'product'
  | 'favorites'
  | 'cart'
  | 'checkout'
  | 'payment'
  | 'orders'
  | 'tracking'
  | 'account'
  | 'support'
  | 'legal'
  | 'otp';

const SHIPPING: Record<string, number> = {
  'store-a': 10000,
  'store-b': 12000,
  'store-c': 15000,
};

export function App() {
  const [route, setRoute] = useState<Route>('home');
  const [locale, setLocale] = useState<Locale>('lo');
  const [query, setQuery] = useState('');
  const [searchTab, setSearchTab] = useState<'products' | 'shops' | 'brands'>('products');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>(PRODUCTS);
  const [catalogSource, setCatalogSource] = useState<'api' | 'fixture'>('fixture');
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(PRODUCTS[0]!);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    categories: true,
    deals: true,
    stores: false,
    tops: true,
  });
  const [favorites, setFavorites] = useState<string[]>(['p1']);
  const [recent, setRecent] = useState<string[]>(['p1', 'p3']);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [online, setOnline] = useState(true);
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpInvite, setOtpInvite] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [sessionLabel, setSessionLabel] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'qr' | 'cod'>('qr');
  const [selectedQrStores, setSelectedQrStores] = useState<string[]>(['store-a', 'store-c']);
  const [orderStatus, setOrderStatus] = useState('awaiting_supplier');
  const [apiOrderId, setApiOrderId] = useState('');
  const [apiOrderLabel, setApiOrderLabel] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromoNote, setAppliedPromoNote] = useState('');
  const [qrPayment, setQrPayment] = useState<QrPayment | null>(null);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [trackingChildren, setTrackingChildren] = useState<
    Array<{ id: string; store_id: string; status: string; total_lak: number | string }>
  >([]);
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackError, setTrackError] = useState('');
  const [notifications] = useState([
    { id: 'n1', title: locale === 'lo' ? 'ຮ້ານຢືນຢັນແລ້ວ' : 'Store confirmed', unread: true },
  ]);

  useEffect(() => {
    void loadCart().then(setCart);
    void loadCatalogProducts().then((result) => {
      setProducts(result.products);
      setCatalogSource(result.source);
      setSelectedProduct((prev) => {
        if (prev && result.products.some((p) => p.id === prev.id)) return prev;
        return result.products[0] ?? null;
      });
      if (result.source === 'api') {
        setFavorites((fav) => fav.filter((id) => result.products.some((p) => p.id === id)));
        setRecent((r) => r.filter((id) => result.products.some((p) => p.id === id)));
      }
    });
    const sync = () => setOnline(readNetworkStatus().online);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    void saveCart(cart);
  }, [cart]);

  const totals = useMemo(() => cartTotals(cart, 5000, SHIPPING), [cart]);
  const cod = evaluateCodUx({
    amountLak: totals.totalLak,
    isNewCustomer: true,
    phoneVerified: loggedIn,
    failCount: 0,
  });

  const sampleOrder = {
    parentId: apiOrderId || 'P-1001',
    status: orderStatus,
    children: totals.groups.map((g, i) => ({
      id: `C-${i + 1}`,
      storeName: g.storeName,
      status: orderStatus === 'awaiting_supplier' || orderStatus === 'pending_supplier' ? 'pending_supplier' : 'in_transit',
      totalLak: g.subtotalLak + (SHIPPING[g.storeId] ?? 10000),
    })),
  };
  const orderSummary = parentChildSummary(sampleOrder);

  function go(next: Route) {
    setRoute(next);
    window.location.hash = next;
  }

  function openProduct(product: CatalogProduct) {
    setSelectedProduct(product);
    setRecent((r) => [product.id, ...r.filter((id) => id !== product.id)].slice(0, 8));
    go('product');
  }

  function addToCart(product: CatalogProduct, variantId?: string) {
    try {
      assertOnlineForMutation(online, 'cart_sync');
    } catch {
      // cart may still be edited offline; checkout blocked later
    }
    const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0]!;
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId: variant.id,
          storeId: product.storeId,
          storeName: product.storeName,
          title: productTitle(product, locale),
          unitPriceLak: variant.priceLak,
          quantity: 1,
        },
      ];
    });
  }

  function placeOrder() {
    assertOnlineForMutation(online, 'checkout');
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !loggedIn) {
      setCheckoutError(locale === 'lo' ? 'ກະລຸນາເຂົ້າສູ່ລະບົບ OTP ກ່ອນ' : 'Sign in with OTP first');
      go('otp');
      return;
    }
    if (catalogSource !== 'api' || cart.length === 0) {
      setOrderStatus('awaiting_supplier');
      setApiOrderLabel('fixture checkout (local stub)');
      go('orders');
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError('');
    void (async () => {
      try {
        const shippingLakByStore: Record<string, number> = {};
        for (const g of groupCartByStore(cart)) {
          shippingLakByStore[g.storeId] = SHIPPING[g.storeId] ?? 10000;
        }
        const result = await checkoutLocalCart({
          sessionToken: token,
          lines: cart.map((l) => ({
            storeId: l.storeId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
          shippingLakByStore,
          promoCode: promoCode.trim() || undefined,
        });
        setApiOrderId(result.parentId);
        setApiOrderLabel(result.orderNumber);
        setAppliedPromoNote(
          result.promo
            ? `${result.promo.code} −${result.promo.percentOff}% (−${formatLak(LAK(result.promo.discountLak))})`
            : '',
        );
        setOrderStatus('awaiting_supplier');
        try {
          const view = await fetchOrderView(token, result.parentId);
          setOrderStatus(String(view.combined.status));
        } catch {
          /* keep awaiting_supplier */
        }
        go('orders');
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'checkout_failed');
      } finally {
        setCheckoutBusy(false);
      }
    })();
  }

  function pay() {
    assertOnlineForMutation(online, 'payment');
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !apiOrderId) {
      setOrderStatus(paymentMethod === 'cod' ? 'awaiting_cod' : 'awaiting_payment');
      setPaymentStatus('fixture stub');
      go('orders');
      return;
    }
    setPayBusy(true);
    setPayError('');
    void (async () => {
      try {
        await confirmChildrenMock(token, apiOrderId);
        if (paymentMethod === 'cod') {
          const codPay = await createCodPayment(token, apiOrderId);
          setQrPayment(null);
          setPaymentStatus(
            `COD deposit ${codPay.totalDepositLak} · due ${codPay.totalBalanceDueLak} LAK`,
          );
          setOrderStatus('awaiting_cod');
          go('orders');
          return;
        }
        const qr = await createQrPayment(token, apiOrderId);
        setQrPayment(qr);
        setPaymentStatus(`QR ${qr.referenceCode} · ${qr.amountLak} LAK`);
        setOrderStatus('awaiting_payment');
        await mockConfirmPayment(token, qr.paymentRequestId);
        const status = await fetchPaymentStatus(token, qr.paymentRequestId);
        setPaymentStatus(`${status.referenceCode} · ${status.status}`);
        setOrderStatus(status.status === 'paid' ? 'paid' : 'awaiting_payment');
        go('orders');
      } catch (err) {
        setPayError(err instanceof Error ? err.message : 'payment_failed');
      } finally {
        setPayBusy(false);
      }
    })();
  }

  function refreshTracking() {
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !apiOrderId) return;
    setTrackBusy(true);
    setTrackError('');
    void (async () => {
      try {
        const view = await fetchOrderView(token, apiOrderId);
        setTrackingChildren(view.byStore);
        setOrderStatus(String(view.combined.status));
      } catch (err) {
        setTrackError(err instanceof Error ? err.message : 'tracking_failed');
      } finally {
        setTrackBusy(false);
      }
    })();
  }

  function advanceTracking() {
    assertOnlineForMutation(online, 'fulfillment');
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !apiOrderId) {
      setTrackError('Sign in and place an API order first');
      return;
    }
    setTrackBusy(true);
    setTrackError('');
    void (async () => {
      try {
        const result = await mockAdvanceFulfillment(token, apiOrderId);
        setTrackingChildren(result.order.byStore);
        setOrderStatus(String(result.order.combined.status));
      } catch (err) {
        setTrackError(err instanceof Error ? err.message : 'fulfillment_failed');
      } finally {
        setTrackBusy(false);
      }
    })();
  }

  function deliverTracking() {
    assertOnlineForMutation(online, 'fulfillment');
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !apiOrderId) {
      setTrackError('Sign in and place an API order first');
      return;
    }
    setTrackBusy(true);
    setTrackError('');
    void (async () => {
      try {
        const result = await mockDeliverFulfillment(token, apiOrderId);
        setTrackingChildren(result.order.byStore);
        setOrderStatus(String(result.order.combined.status));
      } catch (err) {
        setTrackError(err instanceof Error ? err.message : 'deliver_failed');
      } finally {
        setTrackBusy(false);
      }
    })();
  }

  function cancelBeforeHandoff() {
    assertOnlineForMutation(online, 'cancel');
    const token = sessionStorage.getItem('bombee_session');
    if (!token || !apiOrderId) {
      setOrderStatus('cancelled_before_handoff');
      return;
    }
    setCheckoutError('');
    void (async () => {
      try {
        const result = await cancelOrderBeforeHandoff(token, apiOrderId, 'order');
        setTrackingChildren(result.order.byStore);
        setOrderStatus(String(result.order.combined.status));
        setPaymentStatus('cancelled');
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'cancel_failed');
      }
    })();
  }

  const filteredProducts = products.filter((p) => {
    if (selectedCategory && p.categoryId !== selectedCategory) return false;
    if (selectedStore && p.storeId !== selectedStore) return false;
    if (selectedBrand && p.brandId !== selectedBrand) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      p.titleEn.toLowerCase().includes(q) ||
      p.titleLo.includes(query) ||
      p.storeName.toLowerCase().includes(q) ||
      p.brandName.toLowerCase().includes(q)
    );
  });

  const storeOptions = useMemo(() => {
    const fromApi = Array.from(
      new Map(products.map((p) => [p.storeId, { id: p.storeId, name: p.storeName }])).values(),
    );
    return fromApi.length > 0 ? fromApi : [...STORES];
  }, [products]);

  const brandOptions = useMemo(() => {
    const fromApi = Array.from(
      new Map(
        products
          .filter((p) => p.brandId)
          .map((p) => [p.brandId, { id: p.brandId, name: p.brandName }]),
      ).values(),
    );
    return fromApi.length > 0 ? fromApi : [...BRANDS];
  }, [products]);

  const categoryOptions = useMemo(() => {
    const fromApi = Array.from(
      new Map(
        products.map((p) => [
          p.categoryId,
          { id: p.categoryId, lo: p.categoryLo, en: p.categoryEn },
        ]),
      ).values(),
    );
    return fromApi.length > 0 ? fromApi : [...CATEGORIES];
  }, [products]);

  return (
    <div className={`app ${!online ? 'is-offline' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!online && (
        <div className="offline-banner" role="status">
          {locale === 'lo'
            ? 'ອອฟໄລນ໌ — cart ຍັງໃຊ້ໄດ້ແຕ່ຫ້າມ checkout/ຊຳລະ'
            : 'Offline — cart available; checkout and payment blocked'}
        </div>
      )}

      <header className="topnav" aria-label="Customer navigation">
        <button type="button" className="brand-btn" onClick={() => go('home')}>
          {BRAND_NAME}
        </button>
        <nav className="topnav-links" aria-label="Primary">
          <button type="button" onClick={() => go('search')}>
            {locale === 'lo' ? 'ຄົ້ນຫາ' : 'Search'}
          </button>
          <button type="button" onClick={() => go('cart')}>
            {locale === 'lo' ? 'ກະຕ່າ' : 'Cart'} ({cart.reduce((s, l) => s + l.quantity, 0)})
          </button>
          <button type="button" onClick={() => go('orders')}>
            {locale === 'lo' ? 'ອໍເດີ' : 'Orders'}
          </button>
          <button type="button" onClick={() => go(loggedIn ? 'account' : 'otp')}>
            {locale === 'lo' ? 'ບັນຊີ' : 'Account'}
          </button>
        </nav>
        <label className="lang">
          <span className="sr-only">Language</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label="Language"
          >
            <option value="lo">ລາວ</option>
            <option value="en">EN</option>
          </select>
        </label>
      </header>

      <main id="main">
        {route === 'home' && (
          <div className="home">
            <section className="hero" aria-label="Hero">
              <p className="brand-hero">{BRAND_NAME}</p>
              <h1>{locale === 'lo' ? 'ຊື້ເຂົ້ານະຄອນຫຼວງໄດ້ໝັ້ນໃຈ' : 'Shop Vientiane with confidence'}</h1>
              <p className="lede">
                {locale === 'lo'
                  ? 'ຕະຫຼາດຜູ້ຂາຍທີ່ຈັດການ — ສັ່ງຫຼາຍຮ້ານ ໃນເທື່ອດຽວ'
                  : 'Managed reseller marketplace — multi-store checkout in one place'}
              </p>
              <div className="cta-row">
                <button type="button" className="cta primary" onClick={() => go('search')}>
                  {locale === 'lo' ? 'ເລີ່ມຊື້' : 'Start shopping'}
                </button>
                <button type="button" className="cta ghost" onClick={() => go('otp')}>
                  {locale === 'lo' ? 'ເຂົ້າສູ່ລະບົບ OTP' : 'Sign in with OTP'}
                </button>
              </div>
              <div className="hero-plane" aria-hidden="true" />
            </section>

            <HomeSection
              id="categories"
              title={locale === 'lo' ? 'ໝວດໝູ່' : 'Categories'}
              expanded={expanded.categories ?? true}
              onToggle={() => setExpanded((e) => ({ ...e, categories: !e.categories }))}
              onShowAll={() => {
                setSelectedCategory(null);
                go('category');
              }}
              locale={locale}
            >
              <div className="chip-row">
                {categoryOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setSelectedCategory(c.id);
                      go('category');
                    }}
                  >
                    {locale === 'lo' ? c.lo : c.en}
                  </button>
                ))}
              </div>
            </HomeSection>

            <HomeSection
              id="deals"
              title={locale === 'lo' ? 'ໂປຣໂມຊັນ' : 'Deals'}
              expanded={expanded.deals ?? true}
              onToggle={() => setExpanded((e) => ({ ...e, deals: !e.deals }))}
              onShowAll={() => go('search')}
              locale={locale}
            >
              <ProductRow
                products={products.filter((p) => p.deal || Boolean(p.compareAtLak)).slice(0, 6)}
                locale={locale}
                onOpen={openProduct}
                onAdd={addToCart}
              />
            </HomeSection>

            <HomeSection
              id="stores"
              title={locale === 'lo' ? 'ຮ້ານແນະນຳ' : 'Stores'}
              expanded={expanded.stores ?? false}
              onToggle={() => setExpanded((e) => ({ ...e, stores: !e.stores }))}
              onShowAll={() => go('store')}
              locale={locale}
            >
              <div className="chip-row">
                {storeOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setSelectedStore(s.id);
                      go('store');
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </HomeSection>

            <HomeSection
              id="tops"
              title={locale === 'lo' ? 'ສິນຄ້າຍອດນິຍົມ' : 'Top products'}
              expanded={expanded.tops ?? true}
              onToggle={() => setExpanded((e) => ({ ...e, tops: !e.tops }))}
              onShowAll={() => go('search')}
              locale={locale}
            >
              <p className="muted">
                Catalog: {catalogSource === 'api' ? 'local API' : 'fixture fallback'}
              </p>
              <ProductRow products={products} locale={locale} onOpen={openProduct} onAdd={addToCart} />
            </HomeSection>
          </div>
        )}

        {route === 'search' && (
          <section className="page" aria-labelledby="search-heading">
            <h1 id="search-heading">{locale === 'lo' ? 'ຄົ້ນຫາ' : 'Search'}</h1>
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={locale === 'lo' ? 'ສິນຄ້າ / ຮ້ານ / ແບรນด์' : 'Products / shops / brands'}
              aria-label="Search"
            />
            <div className="tabs" role="tablist" aria-label="Search tabs">
              {(['products', 'shops', 'brands'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={searchTab === tab}
                  className={searchTab === tab ? 'tab active' : 'tab'}
                  onClick={() => setSearchTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            {searchTab === 'products' && (
              <ProductRow products={filteredProducts} locale={locale} onOpen={openProduct} onAdd={addToCart} />
            )}
            {searchTab === 'shops' && (
              <ul className="list">
                {storeOptions
                  .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) || !query)
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStore(s.id);
                          go('store');
                        }}
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {searchTab === 'brands' && (
              <ul className="list">
                {brandOptions
                  .filter((b) => b.name.toLowerCase().includes(query.toLowerCase()) || !query)
                  .map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBrand(b.id);
                          go('brand');
                        }}
                      >
                        {b.name}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="search-panel inline">
              <h2>{locale === 'lo' ? 'ຄົ້ນຫາດ້ວຍຮູບ' : 'Image search'}</h2>
              <p className="consent">
                {locale === 'lo'
                  ? 'ໃຊ້ເພື່ອຄົ້ນຫາເທົ່ານັ້ນ · ລຶບໃນ 24 ຊົ່ວໂມງ · ບໍ່ໃຊ້ train/analytics'
                  : 'Search only · deleted in 24h · no train/analytics'}
              </p>
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" />
            </div>
          </section>
        )}

        {(route === 'category' || route === 'store' || route === 'brand') && (
          <section className="page">
            <h1>
              {route === 'category' && (locale === 'lo' ? 'ໝວດໝູ່' : 'Category')}
              {route === 'store' && (locale === 'lo' ? 'ຮ້ານ' : 'Store')}
              {route === 'brand' && (locale === 'lo' ? 'ແບรนด์' : 'Brand')}
            </h1>
            <ProductRow products={filteredProducts} locale={locale} onOpen={openProduct} onAdd={addToCart} />
          </section>
        )}

        {route === 'product' && selectedProduct && (
          <section className="page product-detail">
            <img className="product-hero" src={selectedProduct.image} alt="" />
            <h1>{productTitle(selectedProduct, locale)}</h1>
            <p className="price">{formatLak(LAK(selectedProduct.priceLak), locale === 'lo' ? 'lo-LA' : 'en-US')}</p>
            {typeof selectedProduct.availableQty === 'number' ? (
              <p className="muted">
                {locale === 'lo' ? 'ສະຕັອກ' : 'In stock'}: {selectedProduct.availableQty}
              </p>
            ) : null}
            <p>
              {selectedProduct.storeName} · {selectedProduct.brandName}
            </p>
            <p>{locale === 'lo' ? selectedProduct.shippingNoteLo : selectedProduct.shippingNoteEn}</p>
            {selectedProduct.videoUrl && <p>Video: {selectedProduct.videoUrl}</p>}
            {selectedProduct.tiktokUrl && (
              <p>
                TikTok:{' '}
                <a href={selectedProduct.tiktokUrl} rel="noopener noreferrer">
                  {selectedProduct.tiktokUrl}
                </a>
              </p>
            )}
            <label>
              Variant
              <select
                defaultValue={selectedProduct.variants[0]?.id}
                onChange={(e) => addToCart(selectedProduct, e.target.value)}
                aria-label="Variant"
              >
                {selectedProduct.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} — {formatLak(LAK(v.priceLak))}
                  </option>
                ))}
              </select>
            </label>
            <div className="cta-row">
              <button type="button" className="cta primary" onClick={() => addToCart(selectedProduct)}>
                {locale === 'lo' ? 'ເພີ່ມກະຕ່າ' : 'Add to cart'}
              </button>
              <button
                type="button"
                className="cta ghost"
                onClick={() =>
                  setFavorites((f) =>
                    f.includes(selectedProduct.id)
                      ? f.filter((id) => id !== selectedProduct.id)
                      : [...f, selectedProduct.id],
                  )
                }
              >
                {favorites.includes(selectedProduct.id) ? '★' : '☆'} Favorite
              </button>
            </div>
          </section>
        )}

        {route === 'favorites' && (
          <section className="page">
            <h1>{locale === 'lo' ? 'ລາຍການທີ່ມັກ' : 'Favorites'}</h1>
            <ProductRow
              products={products.filter((p) => favorites.includes(p.id))}
              locale={locale}
              onOpen={openProduct}
              onAdd={addToCart}
            />
            <h2>{locale === 'lo' ? 'ເບິ່ງລ່າສຸດ' : 'Recently viewed'}</h2>
            <ProductRow
              products={products.filter((p) => recent.includes(p.id))}
              locale={locale}
              onOpen={openProduct}
              onAdd={addToCart}
            />
          </section>
        )}

        {route === 'cart' && (
          <section className="page">
            <h1>{locale === 'lo' ? 'ກະຕ່າ (ແຍກຕາມຮ້ານ)' : 'Cart by store'}</h1>
            {groupCartByStore(cart).map((g) => (
              <div key={g.storeId} className="store-block">
                <h2>{g.storeName}</h2>
                <ul>
                  {g.items.map((item) => (
                    <li key={item.variantId}>
                      {item.title} × {item.quantity} —{' '}
                      {formatLak(LAK(item.unitPriceLak * item.quantity))}
                    </li>
                  ))}
                </ul>
                <p>
                  Subtotal {formatLak(LAK(g.subtotalLak))} · Shipping{' '}
                  {formatLak(LAK(SHIPPING[g.storeId] ?? 10000))}
                </p>
              </div>
            ))}
            <p>
              Discount {formatLak(LAK(totals.discountLak))} · Total {formatLak(LAK(totals.totalLak))}
            </p>
            <button
              type="button"
              className="cta primary"
              disabled={!online || cart.length === 0}
              onClick={() => {
                try {
                  assertOnlineForMutation(online, 'checkout');
                  go('checkout');
                } catch (e) {
                  alert(String(e));
                }
              }}
            >
              {locale === 'lo' ? 'ໄປ Checkout' : 'Checkout'}
            </button>
          </section>
        )}

        {route === 'checkout' && (
          <section className="page">
            <h1>Checkout</h1>
            {!online && <p role="alert">Offline — mutations blocked</p>}
            {totals.groups.map((g) => (
              <div key={g.storeId} className="store-block">
                <h2>{g.storeName}</h2>
                <p>
                  Goods {formatLak(LAK(g.subtotalLak))} + ship{' '}
                  {formatLak(LAK(SHIPPING[g.storeId] ?? 10000))}
                </p>
              </div>
            ))}
            <p>Discount {formatLak(LAK(totals.discountLak))}</p>
            <p>
              <strong>Grand total {formatLak(LAK(totals.totalLak))}</strong>
            </p>
            <label className="field">
              Promo code
              <input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="LOCAL10"
                autoComplete="off"
              />
            </label>
            <p className="muted">Local seed code: LOCAL10 (10% off)</p>
            <fieldset>
              <legend>Payment method</legend>
              <label>
                <input
                  type="radio"
                  name="pay"
                  checked={paymentMethod === 'qr'}
                  onChange={() => setPaymentMethod('qr')}
                />{' '}
                QR
              </label>
              <label>
                <input
                  type="radio"
                  name="pay"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                />{' '}
                COD {cod.allowed ? `(deposit ${formatLak(LAK(cod.depositLak))})` : `(blocked: ${cod.reason})`}
              </label>
            </fieldset>
            <button
              type="button"
              className="cta primary"
              disabled={!online || checkoutBusy}
              onClick={() => {
                try {
                  placeOrder();
                } catch (e) {
                  alert(String(e));
                }
              }}
            >
              {checkoutBusy ? 'Placing…' : 'Place order (wait for supplier)'}
            </button>
            {checkoutError ? <p className="error">{checkoutError}</p> : null}
          </section>
        )}

        {route === 'payment' && (
          <section className="page">
            <h1>QR payment</h1>
            {apiOrderId ? (
              <p className="muted">Order {apiOrderLabel || apiOrderId}</p>
            ) : (
              <p className="muted">No API order — fixture payment stub</p>
            )}
            <p>Select cart stores (display only; API pays all children on order):</p>
            {totals.groups.map((g) => (
              <label key={g.storeId} className="check">
                <input
                  type="checkbox"
                  checked={selectedQrStores.includes(g.storeId)}
                  onChange={(e) =>
                    setSelectedQrStores((prev) =>
                      e.target.checked ? [...prev, g.storeId] : prev.filter((id) => id !== g.storeId),
                    )
                  }
                />
                {g.storeName}
              </label>
            ))}
            {qrPayment ? (
              <p>
                QR {qrPayment.referenceCode} · {formatLak(LAK(qrPayment.amountLak))} · expires{' '}
                {qrPayment.expiresAt}
              </p>
            ) : (
              <p>Status: {paymentStatus || 'awaiting transfer · local mock confirm'}</p>
            )}
            <button
              type="button"
              className="cta primary"
              disabled={!online || payBusy}
              onClick={() => {
                try {
                  pay();
                } catch (e) {
                  alert(String(e));
                }
              }}
            >
              {payBusy ? 'Paying…' : 'Simulate confirm + mock pay'}
            </button>
            {payError ? <p className="error">{payError}</p> : null}
          </section>
        )}

        {route === 'orders' && (
          <section className="page">
            <h1>{locale === 'lo' ? 'ປະຫວັດອໍເດີ' : 'Order history'}</h1>
            <p>
              Parent {apiOrderLabel || sampleOrder.parentId} — {sampleOrder.status}
            </p>
            {apiOrderId ? <p className="muted">API order id: {apiOrderId}</p> : null}
            {appliedPromoNote ? <p className="muted">Promo: {appliedPromoNote}</p> : null}
            {paymentStatus ? <p className="muted">Payment: {paymentStatus}</p> : null}
            <h2>Combined</h2>
            <p>Total {formatLak(LAK(orderSummary.combinedTotalLak))}</p>
            <h2>By store</h2>
            <ul>
              {orderSummary.byStore.map((c) => (
                <li key={c.storeName}>
                  {c.storeName}: {c.status} — {formatLak(LAK(c.totalLak))}
                </li>
              ))}
            </ul>
            <div className="cta-row">
              <button type="button" className="cta ghost" onClick={() => go('payment')}>
                Pay QR
              </button>
              <button type="button" className="cta ghost" onClick={() => go('tracking')}>
                Track
              </button>
              <button
                type="button"
                className="cta ghost"
                onClick={() => cancelBeforeHandoff()}
              >
                Cancel before handoff
              </button>
            </div>
          </section>
        )}

        {route === 'tracking' && (
          <section className="page">
            <h1>Tracking</h1>
            {apiOrderId && loggedIn ? (
              <>
                <p className="muted">Order {apiOrderLabel || apiOrderId}</p>
                <div className="cta-row">
                  <button
                    type="button"
                    className="cta ghost"
                    disabled={trackBusy}
                    onClick={() => refreshTracking()}
                  >
                    Refresh status
                  </button>
                  <button
                    type="button"
                    className="cta"
                    disabled={trackBusy}
                    onClick={() => advanceTracking()}
                  >
                    Mock advance fulfillment
                  </button>
                  <button
                    type="button"
                    className="cta ghost"
                    disabled={trackBusy}
                    onClick={() => deliverTracking()}
                  >
                    Mock POD / deliver
                  </button>
                </div>
                {trackError ? <p className="error">{trackError}</p> : null}
                {(trackingChildren.length > 0 ? trackingChildren : []).map((c) => (
                  <ol key={c.id} className="timeline">
                    <li>Child {c.id.slice(0, 8)}… — store {c.store_id.slice(0, 8)}…</li>
                    <li>Status: {c.status}</li>
                    <li>Total: {formatLak(LAK(Number(c.total_lak)))}</li>
                  </ol>
                ))}
                {trackingChildren.length === 0 && !trackBusy ? (
                  <p className="muted">Refresh or advance to load live child statuses.</p>
                ) : null}
              </>
            ) : (
              <>
                {sampleOrder.children.map((c) => (
                  <ol key={c.id} className="timeline">
                    <li>Confirmed — {c.storeName}</li>
                    <li>Packed</li>
                    <li>Handed to courier</li>
                    <li>In transit ({c.status})</li>
                  </ol>
                ))}
              </>
            )}
            <h2>After-sales</h2>
            <button type="button" className="cta ghost">
              Request return / refund + evidence
            </button>
            <button type="button" className="cta ghost">
              Submit review / TikTok link
            </button>
          </section>
        )}

        {route === 'otp' && (
          <section className="page">
            <h1>SMS OTP</h1>
            <label>
              Phone
              <input
                value={otpPhone}
                onChange={(e) => setOtpPhone(e.target.value)}
                placeholder="+85620..."
                aria-label="Phone"
              />
            </label>
            <label>
              Invite code (Staging/Private Beta)
              <input
                value={otpInvite}
                onChange={(e) => setOtpInvite(e.target.value)}
                placeholder="QA-BETA-001"
                aria-label="Invite code"
              />
            </label>
            <label>
              Code
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="6-digit"
                aria-label="OTP code"
              />
            </label>
            {otpHint ? <p className="muted">{otpHint}</p> : null}
            {otpError ? <p className="error">{otpError}</p> : null}
            <button
              type="button"
              className="cta ghost"
              disabled={otpBusy}
              onClick={() => {
                void (async () => {
                  setOtpError('');
                  setOtpHint('');
                  setOtpBusy(true);
                  try {
                    assertOnlineForMutation(readNetworkStatus().online, 'otp_request');
                    const result = await requestCustomerOtp(
                      otpPhone.trim(),
                      otpInvite.trim() || undefined,
                    );
                    if (result.devCode) {
                      setOtpCode(result.devCode);
                      setOtpHint(`Local mock code: ${result.devCode}`);
                    } else {
                      setOtpHint(result.message ?? 'OTP sent if account exists');
                    }
                  } catch (err) {
                    setOtpError(err instanceof Error ? err.message : 'request_failed');
                  } finally {
                    setOtpBusy(false);
                  }
                })();
              }}
            >
              Request OTP
            </button>
            <button
              type="button"
              className="cta primary"
              disabled={otpBusy}
              onClick={() => {
                void (async () => {
                  setOtpError('');
                  setOtpBusy(true);
                  try {
                    assertOnlineForMutation(readNetworkStatus().online, 'otp_verify');
                    const verified = await verifyCustomerOtp(
                      otpPhone.trim(),
                      otpCode.trim(),
                      otpInvite.trim() || undefined,
                    );
                    sessionStorage.setItem('bombee_session', verified.sessionToken);
                    setLoggedIn(true);
                    setSessionLabel(verified.identityId);
                    go('account');
                  } catch (err) {
                    setOtpError(err instanceof Error ? err.message : 'verify_failed');
                  } finally {
                    setOtpBusy(false);
                  }
                })();
              }}
            >
              Verify OTP
            </button>
          </section>
        )}

        {route === 'account' && (
          <section className="page">
            <h1>{locale === 'lo' ? 'ໂປຣໄຟລ໌' : 'Profile'}</h1>
            <p>{loggedIn ? otpPhone || '+85620…' : 'Guest'}</p>
            {sessionLabel ? <p className="muted">Session: {sessionLabel}</p> : null}
            <p>Language: {locale}</p>
            <button
              type="button"
              className="cta ghost"
              onClick={() => {
                void (async () => {
                  const token = sessionStorage.getItem('bombee_session');
                  if (!token) return;
                  try {
                    const me = await fetchSessionMe(token);
                    setSessionLabel(`${me.displayName ?? 'user'} · ${me.phoneE164 ?? ''}`);
                    setLoggedIn(true);
                  } catch (err) {
                    setSessionLabel(err instanceof Error ? err.message : 'session_error');
                  }
                })();
              }}
            >
              Refresh session
            </button>
            <button
              type="button"
              className="cta ghost"
              onClick={() => {
                void (async () => {
                  const token = sessionStorage.getItem('bombee_session');
                  if (token) {
                    try {
                      await logoutSession(token);
                    } catch {
                      /* ignore offline */
                    }
                  }
                  sessionStorage.removeItem('bombee_session');
                  setLoggedIn(false);
                  setSessionLabel('');
                  go('home');
                })();
              }}
            >
              Log out
            </button>
            <h2>Addresses</h2>
            <ul>
              <li>Home — Ban Hatsady (default)</li>
              <li>Office — That Luang (recipient: ທ້າວ ສົມ)</li>
            </ul>
            <h2>Notifications</h2>
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  {n.unread ? '● ' : ''}
                  {n.title}
                </li>
              ))}
            </ul>
            <button type="button" className="cta ghost" onClick={() => go('favorites')}>
              Favorites & recent
            </button>
            <button type="button" className="cta ghost" onClick={() => go('support')}>
              Support
            </button>
            <button type="button" className="cta ghost" onClick={() => go('legal')}>
              Legal
            </button>
          </section>
        )}

        {route === 'support' && (
          <section className="page">
            <h1>Support</h1>
            <ul>
              <li>In-app ticket</li>
              <li>WhatsApp / message reference</li>
              <li>Phone log</li>
            </ul>
          </section>
        )}

        {route === 'legal' && (
          <section className="page">
            <h1>Legal / Privacy / Returns</h1>
            <p className="muted">
              Review checklist: <code>docs/runbooks/legal-privacy-review.md</code> (Owner/local
              counsel sign-off still required — KI-12-03).
            </p>
            <article lang="lo">
              <h2>ນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ</h2>
              <p>
                ເຮົາເກັບເບີໂທ, ທີ່ຢູ່ຈັດສົ່ງ, ແລະປະຫວັດອໍເດີເພື່ອໃຫ້ບໍລິການ Private Beta.
                ຮູບຄົ້ນຫາຖືກລຶບພາຍໃນ 24 ຊົ່ວໂມງ. ບໍ່ຂາຍຂໍ້ມູນລູກຄ້າ.
              </p>
            </article>
            <article lang="en">
              <h2>Privacy policy</h2>
              <p>
                We store phone, delivery address, and order history to operate the Private Beta.
                Search images are purged within 24 hours. We never sell customer data.
              </p>
            </article>
            <article lang="lo">
              <h2>ເງື່ອນໄຂການໃຊ້</h2>
              <p>
                ການສັ່ງຊື້ຜ່ານ BomBee ເປັນ Managed Reseller — ຮ້ານຕົ້ນທາງແພັກ, ຂົນສົ່ງຈັດສົ່ງ.
                ລາຄາເປັນ LAK ເທົ່ານັ້ນ.
              </p>
            </article>
            <article lang="en">
              <h2>Terms of use</h2>
              <p>
                Orders on BomBee are fulfilled as a Managed Reseller: origin stores pack; couriers
                deliver. All prices are integer LAK only.
              </p>
            </article>
            <article lang="lo">
              <h2>ການຄືນສິນຄ້າ</h2>
              <p>ຄືນໄດ້ພາຍໃນ 7 ວັນເມື່ອເສຍ/ຜິດ/ບໍ່ຄົບ — ບໍ່ຮັບປ່ຽນໃຈ. COD/QR ຕາມນະໂຍບາຍຊຳລະ.</p>
            </article>
            <article lang="en">
              <h2>Returns</h2>
              <p>
                Returns within 7 days for defective/wrong/incomplete items — no change-of-mind.
                COD/QR follow the payment policy.
              </p>
            </article>
          </section>
        )}
      </main>

      <footer className="footer">
        <button type="button" onClick={() => go('home')}>
          Home
        </button>
        <button type="button" onClick={() => go('favorites')}>
          Saved
        </button>
        <button type="button" onClick={() => go('support')}>
          Help
        </button>
        <span className="sensitive-flag" data-sensitive={isSensitiveRoute(route) ? 'yes' : 'no'}>
          {isSensitiveRoute(route) ? 'sensitive-view' : 'cacheable-view'}
        </span>
      </footer>
    </div>
  );
}

function HomeSection(props: {
  id: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  onShowAll: () => void;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <section className="home-section" aria-labelledby={`${props.id}-title`}>
      <div className="section-head">
        <h2 id={`${props.id}-title`}>
          <button type="button" className="collapse-btn" aria-expanded={props.expanded} onClick={props.onToggle}>
            {props.title}
          </button>
        </h2>
        <button type="button" className="show-all" onClick={props.onShowAll}>
          {props.locale === 'lo' ? 'ສະແດງທັງໝົດ' : 'Show all'}
        </button>
      </div>
      {props.expanded && props.children}
    </section>
  );
}

function ProductRow(props: {
  products: CatalogProduct[];
  locale: Locale;
  onOpen: (p: CatalogProduct) => void;
  onAdd: (p: CatalogProduct) => void;
}) {
  return (
    <ul className="product-row">
      {props.products.map((p) => (
        <li key={p.id}>
          <button type="button" className="product-link" onClick={() => props.onOpen(p)}>
            <img src={p.image} alt="" width={72} height={72} />
            <span>{productTitle(p, props.locale)}</span>
            <span>{formatLak(LAK(p.priceLak))}</span>
            {typeof p.availableQty === 'number' ? (
              <span className="muted">stock {p.availableQty}</span>
            ) : null}
          </button>
          <button type="button" className="add-btn" onClick={() => props.onAdd(p)}>
            +
          </button>
        </li>
      ))}
    </ul>
  );
}
