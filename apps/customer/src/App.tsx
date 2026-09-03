import { BRAND_NAME } from '@bombee/shared';

export function App() {
  return (
    <div className="shell">
      <header className="hero">
        <p className="brand">{BRAND_NAME}</p>
        <h1>Shop Vientiane with confidence</h1>
        <p className="lede">
          Managed reseller marketplace — Phase 1 foundation. Customer PWA arrives after backoffice
          acceptance.
        </p>
      </header>
      <section className="search-panel" aria-labelledby="image-search-heading">
        <h2 id="image-search-heading">Image search (Phase 1)</h2>
        <p className="consent">
          Upload or capture a product photo to search the catalog. Images are used for search only,
          deleted within 24 hours, and never used for training or analytics.
        </p>
        <div className="search-actions">
          <label className="file-label">
            Camera / file
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              aria-describedby="image-search-heading"
            />
          </label>
          <button type="button" className="scan-btn">
            Scan barcode
          </button>
        </div>
        <p className="hint">OCR text search runs in the browser; max 5 MB JPEG/PNG/WebP.</p>
      </section>
    </div>
  );
}
