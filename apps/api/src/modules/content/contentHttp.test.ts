import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseEnv } from '@bombee/config';

import { createAppRouter } from '../../app.js';
import { createLocalApiServices, type ApiServices } from '../../runtime/createServices.js';

function mockRes() {
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 0,
    writeHead(status: number) {
      this.statusCode = status;
    },
    setHeader() {},
    end(body?: string | Buffer) {
      if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
  } as unknown as ServerResponse & { statusCode: number };
  return {
    res,
    body: () => JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
  };
}

function mockReq(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const stream = {
    method,
    url,
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  return stream as unknown as IncomingMessage;
}

describe('content reviews/tiktok HTTP', () => {
  const env = parseEnv({
    APP_ENV: 'local',
    PUBLIC_API_URL: 'http://localhost:8787',
    PUBLIC_CUSTOMER_URL: 'http://localhost:5173',
    PUBLIC_BACKOFFICE_URL: 'http://localhost:5174',
    EGO_POS_ENABLED: 'false',
    INTEGRATIONS_MODE: 'mock',
  });
  let services: ApiServices;
  let router: ReturnType<typeof createAppRouter>;
  let token: string;

  beforeAll(async () => {
    services = await createLocalApiServices(env);
    router = createAppRouter(env, services);
    const identityId = await services.identity.ensureCustomer('+8562097222040', 'Content QA');
    token = await services.identity.createSession({
      authIdentityId: identityId,
      audience: 'customer',
      ttlMs: 60 * 60_000,
    });
  });

  afterAll(async () => {
    await services.db.close();
  });

  it('lists mock reviews and moderates tiktok links', async () => {
    const seeded = mockRes();
    await router(mockReq('POST', '/v1/ops/reviews/mock-create', { rating: 4 }), seeded.res);
    expect(seeded.res.statusCode).toBe(201);
    const reviewId = seeded.body().reviewId as string;
    expect(reviewId).toBeTruthy();

    const list = mockRes();
    await router(mockReq('GET', '/v1/reviews'), list.res);
    expect(list.res.statusCode).toBe(200);
    expect(
      (list.body().reviews as Array<{ reviewId: string; rating: number }>).some(
        (r) => r.reviewId === reviewId && r.rating === 4,
      ),
    ).toBe(true);

    const product = await services.db.query<{ product_id: string; variant_id: string; store_id: string }>(
      `SELECT pv.product_id, pv.id AS variant_id, pv.store_id
       FROM app.product_variants pv
       JOIN app.products p ON p.id = pv.product_id
       WHERE p.status = 'active' AND pv.status = 'active'
       LIMIT 1`,
    );
    const sell = product.rows[0]!;
    const me = await services.identity.ensureCustomer('+8562097222040', 'Content QA');
    const cartId = await services.orders.createCart(me);
    await services.orders.addCartItem(cartId, {
      storeId: sell.store_id,
      variantId: sell.variant_id,
      quantity: 1,
    });
    const order = await services.orders.checkout({
      cartId,
      customerIdentityId: me,
      actorIdentityId: me,
      correlationId: crypto.randomUUID(),
      shippingLakByStore: { [sell.store_id]: 10000 },
    });
    const childOrderId = order.childIds[0]!;
    await services.db.query(
      `UPDATE app.child_orders
       SET status = 'delivered', payment_received = true, updated_at = timezone('utc', now())
       WHERE id = $1`,
      [childOrderId],
    );

    const created = mockRes();
    await router(
      mockReq(
        'POST',
        '/v1/reviews',
        {
          productId: sell.product_id,
          childOrderId,
          rating: 5,
          bodyEn: 'Great water pack',
        },
        { authorization: `Bearer ${token}` },
      ),
      created.res,
    );
    expect(created.res.statusCode).toBe(201);
    const ownReviewId = created.body().reviewId as string;

    const edited = mockRes();
    await router(
      mockReq(
        'PATCH',
        `/v1/reviews/${ownReviewId}`,
        { rating: 4, bodyEn: 'Edited water pack note' },
        { authorization: `Bearer ${token}` },
      ),
      edited.res,
    );
    expect(edited.res.statusCode).toBe(200);
    expect(edited.body().versionNo).toBe(2);
    expect(
      (edited.body().reviews as Array<{ reviewId: string; rating: number; bodyEn: string | null }>).some(
        (r) => r.reviewId === ownReviewId && r.rating === 4 && r.bodyEn === 'Edited water pack note',
      ),
    ).toBe(true);

    const reply = mockRes();
    await router(
      mockReq('POST', `/v1/ops/reviews/${reviewId}/supplier-response`, {
        body: 'Thanks for your feedback!',
      }),
      reply.res,
    );
    expect(reply.res.statusCode).toBe(201);
    const responseId = reply.body().responseId as string;
    expect(reply.body().status).toBe('pending');

    const approved = mockRes();
    await router(
      mockReq('POST', `/v1/ops/reviews/responses/${responseId}/approve`, {}),
      approved.res,
    );
    expect(approved.res.statusCode).toBe(200);
    expect(approved.body().status).toBe('approved');

    const responses = mockRes();
    await router(mockReq('GET', '/v1/reviews/responses'), responses.res);
    expect(responses.res.statusCode).toBe(200);
    expect(
      (responses.body().responses as Array<{ responseId: string; status: string }>).some(
        (r) => r.responseId === responseId && r.status === 'approved',
      ),
    ).toBe(true);

    const tt = mockRes();
    await router(
      mockReq('POST', '/v1/ops/tiktok-links/mock-submit', {
        url: 'https://www.tiktok.com/@bombee/video/1234567890',
        as: 'supplier',
      }),
      tt.res,
    );
    expect(tt.res.statusCode).toBe(201);
    expect(tt.body().status).toBe('pending');
    const linkId = tt.body().linkId as string;

    const moderated = mockRes();
    await router(
      mockReq('POST', `/v1/ops/tiktok-links/${linkId}/moderate`, { approve: true }),
      moderated.res,
    );
    expect(moderated.res.statusCode).toBe(200);
    expect(moderated.body().status).toBe('published');

    const links = mockRes();
    await router(mockReq('GET', '/v1/tiktok-links'), links.res);
    expect(
      (links.body().links as Array<{ linkId: string; status: string }>).some(
        (l) => l.linkId === linkId && l.status === 'published',
      ),
    ).toBe(true);
  });
});
