# trustone-api

REST API untuk katalog digital & sistem quotation Trustone Borneo Indonesia.
NestJS · PostgreSQL (SQL migration, `pg` tanpa ORM) · MinIO (S3 API).

Frontend ada di repository terpisah: `trustone-web`.
Audit awal, inventaris katalog, dan keputusan skema: `docs/phase-0-audit.md`.

## Prasyarat

- Node.js ≥ 24 (`.nvmrc`) dan pnpm 11
- Docker + Docker Compose

## Setup lokal

```bash
cp .env.example .env          # isi password sendiri; jangan commit .env
pnpm install
pnpm infra:up                 # PostgreSQL 127.0.0.1:5433, MinIO API 127.0.0.1:9000 (console :9001)
pnpm db:migrate               # terapkan migration
pnpm db:seed                  # 28 kategori + settings placeholder (idempoten)
pnpm db:seed:dev-dummy        # DEV SAJA: kontak dummy yang ditandai jelas (situs menampilkan pemberitahuan)
pnpm admin:create             # buat akun admin (prompt, atau env ADMIN_EMAIL/ADMIN_NAME/ADMIN_PASSWORD)
pnpm catalog:import           # impor 402 produk hasil ekstraksi PDF sebagai draft (idempoten)
pnpm start:dev                # http://localhost:4000/api/v1 · Swagger http://localhost:4000/api/docs
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm infra:up` / `infra:down` / `infra:logs` | container PostgreSQL + MinIO |
| `pnpm db:migrate` / `db:migrate:status` | migration (forward-only, checksum dicek) |
| `pnpm db:seed` | data referensi (tidak menimpa perubahan admin) |
| `pnpm db:seed:dev-dummy` | isi kontak/hero kosong dengan nilai DUMMY (ditolak bila `NODE_ENV=production`) |
| `pnpm admin:create [-- --reset-password]` | buat admin / reset password (password min. 12 karakter, tidak pernah dicetak) |
| `pnpm catalog:import [dir]` | impor `data/catalog/extracted` → produk `draft` + `needs_review` |
| `pnpm test` | unit test |
| `pnpm test:e2e` | e2e test (butuh infra + migration + seed) |
| `pnpm lint`, `pnpm build` | lint / build |

## Arsitektur

Modular monolith. Setiap modul: controller → service → repository; SQL terparameterisasi hanya di
repository, ORDER BY hanya dari allowlist.

| Modul | Isi |
|---|---|
| `auth`, `users` | login admin (Argon2id bawaan Node), session token opak (hash SHA-256 di `admin_sessions`), `AdminAuthGuard` untuk semua route `/admin/*`, rate limit login 5/menit |
| `categories`, `brands` | publik (yang aktif) + CRUD admin; hapus ditolak (409) selama masih dipakai produk |
| `products` | katalog publik (search, filter, sort, pagination), detail, CRUD admin, bulk status, spesifikasi JSONB berurutan, varian, produk terkait, gambar (bucket public), dokumen (bucket private, presigned URL) |
| `settings` | `GET /settings/public` (hanya key yang aman ditampilkan) |
| `storage` | klien MinIO; credential tidak pernah dikirim ke browser |
| `catalog-import`, `cli` | impor data katalog & pembuatan admin |
| `health` | `GET /health` (200 / 503 bila DB atau storage mati) |

Format respons: sukses `{ data, meta? }`, error `{ error: { status, code, message, details? } }`.

## Endpoint utama

Publik: `GET /products`, `GET /products/:slug`, `GET /products/:slug/documents/:id/url`,
`GET /categories`, `GET /brands`, `GET /settings/public`, `GET /health`.

Admin (Bearer token): `POST /admin/auth/login|logout`, `GET /admin/auth/me`,
CRUD `/admin/categories`, `/admin/brands`, `/admin/products`, `POST /admin/products/bulk-status`,
`/admin/products/:id/images[/:imageId]`, `/admin/products/:id/documents[/:docId][/url]`.
Detail request/response: Swagger.

## Upload file

- Validasi isi file (magic bytes), bukan nama/MIME dari klien: gambar JPEG/PNG/WebP ≤ `UPLOAD_IMAGE_MAX_MB`
  (5), dokumen PDF ≤ `UPLOAD_DOCUMENT_MAX_MB` (20).
- Object key dibuat server: `products/{productId}/images/{uuid}.{ext}`, `products/{productId}/documents/{uuid}.pdf`.
- Gambar → bucket public (baca anonim). Dokumen → bucket private, diunduh lewat presigned URL 5 menit.

## Environment

Lihat `.env.example`; divalidasi saat start (`src/config/env.validation.ts`).
`TRUST_PROXY` menentukan IP klien untuk rate limiting di belakang web BFF / reverse proxy.

## Catatan produksi (belum dikerjakan, Phase 5)

Swagger dimatikan saat `NODE_ENV=production`. Belum ada Dockerfile/deployment, backup terjadwal,
dan monitoring. Lihat risiko MinIO di `docs/phase-0-audit.md`.
