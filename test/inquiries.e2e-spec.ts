// Requires the docker compose infrastructure (PostgreSQL + MinIO) and the root .env.
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/database/database.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Inquiries (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let categoryId: string;
  let publishedId: string;
  let variantId: string;
  let draftId: string;
  const sfx = randomBytes(4).toString('hex');
  const mail = `e2e-inq-${sfx}@test.local`;
  const pw = `pw-${randomBytes(12).toString('hex')}`;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:3000']);
    await app.init();
    db = app.get(DatabaseService);
    await db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('E2E', $1, $2, 'admin')`, [mail, await hashPassword(pw)]);
    token = (await http().post('/api/v1/admin/auth/login').send({ email: mail, password: pw })).body.data.token;
    categoryId = (await http().post('/api/v1/admin/categories').set(auth()).send({ name: `E2E Inq ${sfx}`, slug: `e2e-inq-${sfx}` })).body.data.id;
    const published = await http()
      .post('/api/v1/admin/products')
      .set(auth())
      .send({
        name: `E2E Inq Produk ${sfx}`,
        slug: `e2e-inq-p-${sfx}`,
        sku: `E2E-INQ-${sfx}`,
        categoryId,
        status: 'published',
        variants: [{ name: 'Putih', sku: `E2E-INQ-V-${sfx}`, attributes: { Warna: 'White' } }],
      })
      .expect(201);
    publishedId = published.body.data.id;
    variantId = published.body.data.variants[0].id;
    draftId = (await http().post('/api/v1/admin/products').set(auth()).send({ name: `E2E Inq Draft ${sfx}`, slug: `e2e-inq-d-${sfx}`, categoryId }).expect(201)).body.data.id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM inquiries WHERE customer_name LIKE $1`, [`E2E ${sfx}%`]);
    await db.query(`DELETE FROM products WHERE slug LIKE $1`, [`e2e-inq-%-${sfx}`]);
    await db.query(`DELETE FROM categories WHERE slug = $1`, [`e2e-inq-${sfx}`]);
    await db.query(`DELETE FROM users WHERE email = $1`, [mail]);
    await app.close();
  });

  const body = (items: unknown[], extra: Record<string, unknown> = {}) => ({
    customerName: `E2E ${sfx} Budi`,
    companyName: 'PT Uji',
    whatsappNumber: '0812-8227-1323',
    items,
    ...extra,
  });

  it('saves an inquiry with snapshots, normalized number and reference code', async () => {
    const res = await http()
      .post('/api/v1/inquiries')
      .send(body([{ productId: publishedId, variantId, quantity: 3 }, { productId: publishedId, variantId, quantity: 2 }]))
      .expect(201);
    expect(res.body.data.referenceCode).toMatch(/^INQ-\d{4}-\d{6}$/);
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ productName: `E2E Inq Produk ${sfx}`, sku: `E2E-INQ-V-${sfx}`, variantName: 'Putih', quantity: 5 }),
    ]);
    expect(res.body.data).not.toHaveProperty('internalNote');

    const row = await db.query(`SELECT whatsapp_number, status FROM inquiries WHERE reference_code = $1`, [res.body.data.referenceCode]);
    expect(row.rows[0]).toEqual({ whatsapp_number: '+6281282271323', status: 'new' });
  });

  it('issues increasing reference codes', async () => {
    const a = await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 1 }])).expect(201);
    const b = await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 1 }])).expect(201);
    expect(b.body.data.referenceCode > a.body.data.referenceCode).toBe(true);
  });

  it('rejects drafts, unknown products, empty lists and bad input; nothing is saved', async () => {
    const before = Number((await db.query(`SELECT count(*) AS n FROM inquiries WHERE customer_name LIKE $1`, [`E2E ${sfx}%`])).rows[0].n);
    const draft = await http().post('/api/v1/inquiries').send(body([{ productId: draftId, quantity: 1 }])).expect(400);
    expect(draft.body.error.details.productIds).toEqual([draftId]);
    await http().post('/api/v1/inquiries').send(body([{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }])).expect(400);
    await http().post('/api/v1/inquiries').send(body([])).expect(400);
    await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 0 }])).expect(400);
    await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 1 }], { whatsappNumber: 'abc' })).expect(400);
    await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 1 }], { hacker: true })).expect(400);
    const after = Number((await db.query(`SELECT count(*) AS n FROM inquiries WHERE customer_name LIKE $1`, [`E2E ${sfx}%`])).rows[0].n);
    expect(after).toBe(before);
  });

  it('admin endpoints require a session', async () => {
    await http().get('/api/v1/admin/inquiries').expect(401);
  });

  it('admin lists, reads, and updates status + internal note with an audit trail', async () => {
    const created = await http().post('/api/v1/inquiries').send(body([{ productId: publishedId, quantity: 7, customerNote: 'warna kuning' }])).expect(201);
    const code: string = created.body.data.referenceCode;

    const list = await http().get('/api/v1/admin/inquiries').query({ q: code }).set(auth()).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ referenceCode: code, itemCount: 1, totalQuantity: 7, status: 'new' });
    expect(list.body.meta.statusCounts.new).toBeGreaterThanOrEqual(1);
    const id: string = list.body.data[0].id;

    const detail = await http().get(`/api/v1/admin/inquiries/${id}`).set(auth()).expect(200);
    expect(detail.body.data.items[0]).toMatchObject({ quantity: 7, customerNote: 'warna kuning', productSlug: `e2e-inq-p-${sfx}` });

    const updated = await http().patch(`/api/v1/admin/inquiries/${id}`).set(auth()).send({ status: 'contacted', internalNote: 'dihubungi sales' }).expect(200);
    expect(updated.body.data).toMatchObject({ status: 'contacted', internalNote: 'dihubungi sales' });
    await http().patch(`/api/v1/admin/inquiries/${id}`).set(auth()).send({ status: 'bogus' }).expect(400);

    const audit = await db.query(`SELECT action FROM audit_logs WHERE entity_type = 'inquiry' AND entity_id = $1 ORDER BY id`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['created', 'status_changed', 'internal_note_changed']);

    const filtered = await http().get('/api/v1/admin/inquiries').query({ status: 'contacted', q: code }).set(auth()).expect(200);
    expect(filtered.body.data).toHaveLength(1);
  });
});
