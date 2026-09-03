#!/usr/bin/env node
/**
 * Generate synthetic Staging QA catalog (100–500 products).
 * Never includes real customers, phones, or payment identifiers.
 *
 * Usage:
 *   node scripts/seed-staging-qa.mjs [--count=250] [--out=tests/fixtures/staging-qa-catalog.json]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function parseArgs(argv) {
  let count = 250;
  let out = path.join(root, 'tests/fixtures/staging-qa-catalog.json');
  for (const arg of argv) {
    if (arg.startsWith('--count=')) count = Number(arg.slice('--count='.length));
    if (arg.startsWith('--out=')) out = path.resolve(root, arg.slice('--out='.length));
  }
  if (!Number.isInteger(count) || count < 100 || count > 500) {
    throw new Error('--count must be an integer between 100 and 500');
  }
  return { count, out };
}

const categories = [
  { lo: 'ເຄື່ອງດື່ມ', en: 'Beverages' },
  { lo: 'ອາຫານ', en: 'Food' },
  { lo: 'ເຄື່ອງໃຊ້ໃນບ້ານ', en: 'Household' },
  { lo: 'ສຸຂະພາບ', en: 'Health' },
  { lo: 'ເຄື່ອງນຸ່ງ', en: 'Apparel' },
];

function buildFixture(count) {
  const storeCount = Math.min(12, Math.max(3, Math.ceil(count / 40)));
  const stores = Array.from({ length: storeCount }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      id: `store_qa_${n}`,
      name: `QA Store ${n}`,
      status: 'active',
      synthetic: true,
    };
  });

  const customers = Array.from({ length: 20 }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      id: `cust_qa_${n}`,
      displayName: `QA Customer ${n}`,
      phoneE164: `+85620${String(90000000 + i).padStart(8, '0')}`,
      locale: i % 2 === 0 ? 'lo' : 'en',
      synthetic: true,
    };
  });

  const products = Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(4, '0');
    const store = stores[i % stores.length];
    const category = categories[i % categories.length];
    const priceLak = 5000 + (i % 50) * 1000;
    return {
      id: `prod_qa_${n}`,
      storeId: store.id,
      sku: `QA-SKU-${n}`,
      title: {
        lo: `${category.lo} ທົດສອບ ${n}`,
        en: `${category.en} QA Item ${n}`,
      },
      category: category.en,
      priceLak,
      stockQty: 10 + (i % 40),
      synthetic: true,
    };
  });

  const invites = Array.from({ length: 10 }, (_, i) => ({
    inviteCode: `QA-BETA-${String(i + 1).padStart(3, '0')}`,
    maxUses: 5,
    intendedRole: i === 0 ? 'ops' : 'customer',
    synthetic: true,
  }));

  return {
    description:
      'Synthetic Staging QA seed (100–500 items). No real PII, payments, or Production data.',
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    customers,
    stores,
    products,
    invites,
  };
}

const { count, out } = parseArgs(process.argv.slice(2));
const fixture = buildFixture(count);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      productCount: fixture.productCount,
      storeCount: fixture.stores.length,
      inviteCount: fixture.invites.length,
    },
    null,
    2,
  ),
);
