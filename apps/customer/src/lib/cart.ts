export type CartLine = {
  productId: string;
  variantId: string;
  storeId: string;
  storeName: string;
  title: string;
  unitPriceLak: number;
  quantity: number;
};

const DB_NAME = 'bombee-customer';
const STORE = 'cart';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCart(): Promise<CartLine[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const get = tx.objectStore(STORE).get('lines');
    get.onsuccess = () => resolve((get.result as CartLine[] | undefined) ?? []);
    get.onerror = () => reject(get.error);
  });
}

export async function saveCart(lines: CartLine[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(lines, 'lines');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function groupCartByStore(lines: CartLine[]) {
  const map = new Map<string, CartLine[]>();
  for (const line of lines) {
    const list = map.get(line.storeId) ?? [];
    list.push(line);
    map.set(line.storeId, list);
  }
  return [...map.entries()].map(([storeId, items]) => ({
    storeId,
    storeName: items[0]?.storeName ?? storeId,
    items,
    subtotalLak: items.reduce((s, i) => s + i.unitPriceLak * i.quantity, 0),
  }));
}

export function cartTotals(lines: CartLine[], discountLak = 0, shippingLakByStore: Record<string, number> = {}) {
  const groups = groupCartByStore(lines);
  const subtotalLak = groups.reduce((s, g) => s + g.subtotalLak, 0);
  const shippingLak = groups.reduce((s, g) => s + (shippingLakByStore[g.storeId] ?? 10000), 0);
  const totalLak = Math.max(0, subtotalLak - discountLak + shippingLak);
  return { groups, subtotalLak, discountLak, shippingLak, totalLak };
}

export function canMutateOrders(online: boolean): boolean {
  return online;
}
