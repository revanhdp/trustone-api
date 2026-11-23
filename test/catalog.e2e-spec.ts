// Requires the docker compose infrastructure (PostgreSQL + MinIO), migrations and `pnpm db:seed`.
// Creates its own admin and data with a unique suffix and removes them afterwards.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/database/database.service.js';
import { setupApp } from '../src/setup-app.js';

const suffix = randomBytes(4).toString('hex');
const email = `e2e-${suffix}@test.local`;
const password = `pw-${randomBytes(12).toString('hex')}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('Catalog + admin (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let categoryId: string;
  let productId: string;
  const slug = `e2e-produk-${suffix}`;

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:3000']);
    await app.init();
    db = app.get(DatabaseService);
    await db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`, [
      'E2E Admin',
      email,
      await hashPassword(password),
    ]);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM products WHERE slug LIKE $1`, [`e2e-%-${suffix}%`]);
    await db.query(`DELETE FROM categories WHERE slug LIKE $1`, [`e2e-%-${suffix}`]);
    await db.query(`DELETE FROM users WHERE email = $1`, [email]);
    await app.close();
  });

  describe('auth', () => {
    it('rejects admin routes without a session', async () => {
      const res = await http().get('/api/v1/admin/products').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      await http().get('/api/v1/admin/products').set('Authorization', 'Bearer not-a-token').expect(401);
    });

    it('rejects a wrong password with a generic message', async () => {
      const res = await http().post('/api/v1/admin/auth/login').send({ email, password: 'wrong-password' }).expect(401);
      expect(res.body.error.message).toBe('Email atau password salah');
    });

    it('logs in and returns an opaque token', async () => {
      const res = await http().post('/api/v1/admin/auth/login').send({ email, password }).expect(200);
      token = res.body.data.token;
      expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(res.body.data.user).toMatchObject({ email, role: 'admin' });
      expect(JSON.stringify(res.body)).not.toContain('password');
      const me = await http().get('/api/v1/admin/auth/me').set(auth()).expect(200);
      expect(me.body.data.email).toBe(email);
    });
  });

  describe('categories', () => {
    it('creates a category and refuses to delete it while products use it', async () => {
      const created = await http()
        .post('/api/v1/admin/categories')
        .set(auth())
        .send({ name: `E2E Kategori ${suffix}`, slug: `e2e-kategori-${suffix}` })
        .expect(201);
      categoryId = created.body.data.id;
      expect(created.body.data).toMatchObject({ isActive: true, productCount: 0 });

      await http()
        .post('/api/v1/admin/categories')
        .set(auth())
        .send({ name: 'Duplikat', slug: `e2e-kategori-${suffix}` })
        .expect(409);
      await http().post('/api/v1/admin/categories').set(auth()).send({ name: '' }).expect(400);
    });
  });

  describe('products', () => {
    it('validates input', async () => {
      const res = await http()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({ name: 'X', categoryId: 'not-a-uuid', specs: [{ key: 'Warna', value: 12 }], hacker: true })
        .expect(400);
      expect(res.body.error.message).toBe('Validasi gagal');
    });

    it('creates a draft product with specs and variants', async () => {
      const res = await http()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({
          name: `E2E Helm ${suffix}`,
          slug,
          sku: `E2E-${suffix}`,
          categoryId,
          shortDescription: 'Helm uji',
          specs: [
            { key: 'Material', value: 'ABS' },
            { key: 'Color', value: ['White', 'Yellow'] },
          ],
          variants: [{ name: 'Putih', attributes: { Warna: 'White' } }],
        })
        .expect(201);
      productId = res.body.data.id;
      expect(res.body.data).toMatchObject({ status: 'draft', specs: [{ key: 'Material', value: 'ABS' }, { key: 'Color', value: ['White', 'Yellow'] }] });
      expect(res.body.data.variants).toHaveLength(1);
    });

    it('rejects a duplicate SKU (case-insensitive)', async () => {
      await http()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({ name: 'Dup', slug: `e2e-dup-${suffix}`, sku: `e2e-${suffix}`.toLowerCase(), categoryId })
        .expect(409);
    });

    it('keeps drafts out of the public catalog', async () => {
      await http().get(`/api/v1/products/${slug}`).expect(404);
      const list = await http().get('/api/v1/products').query({ q: suffix }).expect(200);
      expect(list.body.data).toHaveLength(0);
    });

    it('uploads images (first becomes primary) and rejects fake images', async () => {
      const first = await http()
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth())
        .attach('file', PNG, { filename: 'helm.png', contentType: 'image/png' })
        .field('altText', 'Helm putih')
        .expect(201);
      expect(first.body.data).toHaveLength(1);
      expect(first.body.data[0]).toMatchObject({ isPrimary: true, altText: 'Helm putih' });
      const imageUrl: string = first.body.data[0].url;
      expect(imageUrl).toMatch(new RegExp(`/products/${productId}/images/[0-9a-f-]+\\.png$`));
      const publicFetch = await fetch(imageUrl);
      expect(publicFetch.status).toBe(200);

      const second = await http()
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth())
        .attach('file', PNG, { filename: 'helm2.png', contentType: 'image/png' })
        .expect(201);
      expect(second.body.data.filter((i: { isPrimary: boolean }) => i.isPrimary)).toHaveLength(1);

      await http()
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth())
        .attach('file', Buffer.from('MZ fake'), { filename: 'virus.png', contentType: 'image/png' })
        .expect(400);
    });

    it('uploads a private document and serves it via a short-lived URL', async () => {
      const res = await http()
        .post(`/api/v1/admin/products/${productId}/documents`)
        .set(auth())
        .attach('file', PDF, { filename: 'datasheet.pdf', contentType: 'application/pdf' })
        .field('title', 'Datasheet')
        .field('documentType', 'datasheet')
        .field('isPublic', 'true')
        .expect(201);
      const doc = res.body.data[0];
      expect(doc).toMatchObject({ title: 'Datasheet', isPublic: true, mimeType: 'application/pdf' });

      const url = await http().get(`/api/v1/admin/products/${productId}/documents/${doc.id}/url`).set(auth()).expect(200);
      expect(url.body.data.url).toContain('X-Amz-Signature');
      const download = await fetch(url.body.data.url);
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer()).toString('ascii', 0, 5)).toBe('%PDF-');
    });

    it('publishes and exposes the product publicly with search and filters', async () => {
      await http().patch(`/api/v1/admin/products/${productId}`).set(auth()).send({ status: 'published' }).expect(200);

      const detail = await http().get(`/api/v1/products/${slug}`).expect(200);
      expect(detail.body.data).toMatchObject({ slug, category: { slug: `e2e-kategori-${suffix}` } });
      expect(detail.body.data.images).toHaveLength(2);
      expect(detail.body.data.documents).toHaveLength(1);
      expect(detail.body.data).not.toHaveProperty('reviewNotes');
      expect(detail.body.data).not.toHaveProperty('status');

      const byName = await http().get('/api/v1/products').query({ q: `helm ${suffix}` }).expect(200);
      expect(byName.body.data.map((p: { slug: string }) => p.slug)).toEqual([slug]);
      const bySku = await http().get('/api/v1/products').query({ q: `E2E-${suffix}` }).expect(200);
      expect(bySku.body.data).toHaveLength(1);
      const byCategory = await http().get('/api/v1/products').query({ category: `e2e-kategori-${suffix}` }).expect(200);
      expect(byCategory.body.meta.total).toBe(1);

      // LIKE wildcards are matched literally
      const wildcard = await http().get('/api/v1/products').query({ q: '%' }).expect(200);
      expect(wildcard.body.data.every((p: { name: string }) => p.name.includes('%'))).toBe(true);

      await http().get('/api/v1/products').query({ sort: 'price; DROP TABLE products' }).expect(400);

      const doc = detail.body.data.documents[0];
      const url = await http().get(`/api/v1/products/${slug}/documents/${doc.id}/url`).expect(200);
      expect(url.body.data.url).toContain('X-Amz-Signature');
    });

    it('refuses to delete a category that still has products', async () => {
      const res = await http().delete(`/api/v1/admin/categories/${categoryId}`).set(auth()).expect(409);
      expect(res.body.error.message).toContain('masih dipakai');
    });

    it('archives via bulk status and hides the product again', async () => {
      const res = await http()
        .post('/api/v1/admin/products/bulk-status')
        .set(auth())
        .send({ ids: [productId], status: 'archived' })
        .expect(200);
      expect(res.body.data.updated).toBe(1);
      await http().get(`/api/v1/products/${slug}`).expect(404);
    });

    it('deletes the product, its files, and then the empty category', async () => {
      const before = await db.query<{ object_key: string }>(
        `SELECT f.object_key FROM files f JOIN product_images pi ON pi.file_id = f.id WHERE pi.product_id = $1`,
        [productId],
      );
      await http().delete(`/api/v1/admin/products/${productId}`).set(auth()).expect(204);
      await http().get(`/api/v1/admin/products/${productId}`).set(auth()).expect(404);
      const remaining = await db.query(`SELECT 1 FROM files WHERE object_key = ANY($1::text[])`, [
        before.rows.map((r) => r.object_key),
      ]);
      expect(remaining.rows).toHaveLength(0);
      await http().delete(`/api/v1/admin/categories/${categoryId}`).set(auth()).expect(204);
    });
  });

  it('logout invalidates the session', async () => {
    await http().post('/api/v1/admin/auth/logout').set(auth()).expect(204);
    await http().get('/api/v1/admin/auth/me').set(auth()).expect(401);
  });

  it('public settings never expose non-public keys', async () => {
    const res = await http().get('/api/v1/settings/public').expect(200);
    expect(res.body.data).toHaveProperty('company.name');
    expect(res.body.data).not.toHaveProperty('quotation.default_terms');
  });
});

describe('Category image (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let categoryId: string;
  const sfx = randomBytes(4).toString('hex');
  const mail = `e2e-img-${sfx}@test.local`;
  const pw = `pw-${randomBytes(12).toString('hex')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:3000']);
    await app.init();
    db = app.get(DatabaseService);
    await db.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('E2E', $1, $2, 'admin')`, [mail, await hashPassword(pw)]);
    token = (await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ email: mail, password: pw })).body.data.token;
    categoryId = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `E2E Img ${sfx}`, slug: `e2e-img-${sfx}` })
    ).body.data.id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM categories WHERE id = $1`, [categoryId]);
    await db.query(`DELETE FROM users WHERE email = $1`, [mail]);
    await app.close();
  });

  it('uploads, replaces (old object removed) and removes the image', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const first = await request(app.getHttpServer())
      .post(`/api/v1/admin/categories/${categoryId}/image`)
      .set(auth)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    const firstUrl: string = first.body.data.imageUrl;
    expect(firstUrl).toMatch(new RegExp(`/categories/${categoryId}/[0-9a-f-]+\\.png$`));
    expect((await fetch(firstUrl)).status).toBe(200);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/admin/categories/${categoryId}/image`)
      .set(auth)
      .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
      .expect(201);
    expect(second.body.data.imageUrl).not.toBe(firstUrl);
    expect((await fetch(firstUrl)).status).toBe(404);

    const list = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === categoryId).imageUrl).toBe(second.body.data.imageUrl);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/categories/${categoryId}/image`)
      .set(auth)
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);

    const removed = await request(app.getHttpServer()).delete(`/api/v1/admin/categories/${categoryId}/image`).set(auth).expect(200);
    expect(removed.body.data.imageUrl).toBeNull();
    expect((await fetch(second.body.data.imageUrl)).status).toBe(404);
    const files = await db.query(`SELECT 1 FROM files WHERE object_key LIKE $1`, [`categories/${categoryId}/%`]);
    expect(files.rows).toHaveLength(0);
  });
});
