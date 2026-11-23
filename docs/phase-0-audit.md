# Phase 0 — Audit, inventaris katalog, dan rencana

Tanggal: 21 November 2026

## 1. Hasil audit repository

Kondisi awal folder proyek: hanya `brief-trustone-digital-catalog.md` dan
`Katalog_Trustone_Borneo_Indonesia.pdf`. Belum ada kode, belum ada repository git, tidak ada
konfigurasi yang harus dipertahankan. Stack mengikuti brief tanpa perubahan.

Lingkungan pengembangan yang tersedia: Node 24, pnpm 11, Docker 29, PostgreSQL client 18.

## 2. Inventaris katalog PDF

PDF: 51 halaman landscape, judul "Katalog Produk Trustone Borneo Indonesia 2026", memiliki
bookmark/outline 28 kategori.

| No | Kategori | Halaman PDF | Produk terekstrak |
|---|---|---|---|
| 1 | Field Uniform & Activewear | 3–4 | 4 |
| 2 | Rescue & Protective Wear | 4 | 4 |
| 3 | Drone Pemadam Kebakaran | 5–6 | 6 |
| 4 | Manpack Surveillance | 7 | 1 |
| 5 | Aegis Intelligence Pole | 7 | 1 |
| 6 | Wipers & Spill Control | 8 | 13 |
| 7 | Perlindungan Kimia | 9 | 11 |
| 8 | Perlindungan Kepala | 10 | 7 |
| 9 | Perlindungan Mata & Wajah | 11–12 | 12 |
| 10 | Sarung Tangan Sekali Pakai | 13 | 13 |
| 11 | Sarung Tangan Kerja | 14–19 | 47 |
| 12 | Hot Metal Equipment | 20 | 5 |
| 13 | Perlindungan Pernapasan | 21–22 | 17 |
| 14 | Perlindungan Jatuh | 23–25 | 53 |
| 15 | Perlindungan Pendengaran | 26 | 6 |
| 16 | Perlindungan Kaki | 27–28 | 18 |
| 17 | Polymer Material | 29–31 | 36 |
| 18 | Rescue Equipment | 32–33 | 15 |
| 19 | SCBA & Airline | 34 | 10 |
| 20 | Lockout/Tagout | 35–37 | 23 |
| 21 | Chemical Spill | 38 | 6 |
| 22 | Chemical Equipment | 39 | 7 |
| 23 | Electrical Equipment | 40–42 | 11 |
| 24 | Chemical Pump | 43 | 4 |
| 25 | Other Equipment | 44 | 3 |
| 26 | Body Protection | 45–46 | 20 |
| 27 | Fire Protection | 47–49 | 37 |
| 28 | Traffic Control | 50 | 12 |
| | **Total** | | **402** |

Data mentah ada di `data/catalog/extracted/` (format dan ringkasan: `data/catalog/README.md`).

### Temuan kualitas data

- **Teks perusahaan lain di dalam PDF.** Halaman 8–50 berisi teks tersembunyi dari layout perusahaan
  lain (PT Tahta Kasih Karunia: alamat Mataram/Sidoarjo/Sumbawa/Timika, email `tkk.co.id`, telepon
  +62851...), tertutup footer Trustone. Pada halaman 48–50 logo "PT TAHTA KASIH KARUNIA" **terlihat**
  di kartu produk. Data ini tidak dipakai sama sekali, tetapi perlu dikonfirmasi ke pemilik proyek.
- **SKU jarang dan tidak unik.** Hanya 17 produk punya kode berlabel. `SKU 001` dipakai 4 produk
  berbeda; kode `65800` dipakai 2 produk. Kebanyakan "kode" adalah nomor model di nama produk.
- **Brand** sebagian besar hanya berupa logo (171 dari 342 produk ber-brand).
- **Halaman 5–7** (drone, weather station, surveillance) tidak punya text layer; dibaca dari gambar.
- **Deskripsi tersalin/terpotong** di beberapa kartu (mis. Alphatec 02-100 memakai deskripsi
  Solvex 37-165; LOTOTO L3822 memakai teks L3823; beberapa deskripsi terpotong).
- **Nama duplikat** pada 8 judul (kartu berbeda dengan judul sama).
- Sertifikasi banyak yang berupa piktogram beresolusi rendah; hanya standar yang tertulis sebagai
  teks yang dicatat.
- Banyak produk hanya berupa nama tanpa deskripsi/spesifikasi (mis. hlm. 23, 45, 47–50).

Semua temuan per produk tercatat di field `review_notes`.

## 3. Struktur project

Awalnya monorepo; atas keputusan pemilik proyek (21 Nov 2026) dipisah menjadi dua repository:

```
trustone-api/                NestJS (REST /api/v1), pg tanpa ORM
├── migrations/              SQL migration versioned (NNNN_name.sql)
├── scripts/                 migrate.ts, seed.ts, seed-dev-dummy.ts
├── src/                     modul: auth, users, categories, brands, products, settings,
│                            storage, files, catalog-import, cli, health, config, database, common
├── test/                    e2e (Vitest + supertest)
├── data/catalog/            hasil ekstraksi PDF
├── docs/
└── docker-compose.yml       PostgreSQL + MinIO untuk development

trustone-web/                Next.js App Router + Tailwind
└── src/app/(site)           situs publik · src/app/admin panel admin · src/app/api BFF
```

Modul berikutnya: `inquiries`, `quotations`, `dashboard`, pengaturan admin.

## 4. Keputusan skema database (`apps/api/migrations/0001_init.sql`)

- **UUID** sebagai primary key semua entitas publik: tidak membocorkan urutan/jumlah data.
- **Spesifikasi produk = kolom JSONB `products.specs`** berupa array berurutan
  `[{"key": "Material", "value": "ABS"}, {"key": "Color", "value": ["White", "Yellow"]}]`.
  Alasan: atribut sangat bervariasi antar kategori; urutan tampil katalog perlu dijaga (objek JSONB
  tidak menjaga urutan); tetap bisa difilter dengan `specs @> '[{"key":"Material","value":"ABS"}]'`
  memakai indeks GIN. Bila nanti ada atribut yang sering difilter lintas produk, dapat ditambah
  tabel facet terpisah tanpa mengubah data lama.
- **SKU** unik hanya bila terisi (partial unique index, case-insensitive). Karena katalog punya SKU
  duplikat, import akan mengosongkan SKU yang bentrok dan mencatatnya di `review_notes`.
- **Kolom pendukung review import**: `source_page`, `needs_review`, `review_notes`, `import_key`
  (unik, untuk import idempoten).
- **Uang** memakai `numeric(18,2)`; total dihitung di backend. Kuantitas `CHECK (> 0)`.
- **Snapshot** nama/SKU di `inquiry_items` dan `quotation_items`; FK ke produk `ON DELETE SET NULL`.
- **Quotation**: token publik hanya disimpan sebagai hash SHA-256 (`public_token_hash`); revisi =
  baris baru dengan `parent_quotation_id` (quotation terbit tidak ditimpa); `revoked_at`,
  `valid_until`, `audit_logs` untuk riwayat.
- **`document_counters`** untuk nomor inquiry/quotation yang aman terhadap konkurensi; formatnya
  dibuat konfigurable karena belum ditentukan.
- **Kategori/brand** dengan FK `ON DELETE RESTRICT` dari produk: tidak bisa dihapus selama dipakai.
- `internal_note` ada di `inquiries` dan `quotations`, tidak pernah dikirim ke endpoint publik.

## 5. Milestone

| Phase | Isi | Status |
|---|---|---|
| 0 | Audit, inventaris katalog, rencana | Selesai |
| 1 | Monorepo, Docker Compose (PostgreSQL + MinIO), migration + seed, API health, Swagger, web dasar | Selesai |
| 2 | Auth admin, CRUD kategori/brand/produk, upload MinIO, import data katalog (draft), API publik, beranda + katalog + detail produk | Selesai |
| 3 | Inquiry Cart, submit inquiry + snapshot, reference, WhatsApp, admin inquiry | Berikutnya |
| 4 | Quotation builder, token publik, halaman quotation, PDF, respons customer, audit | |
| 5 | Dashboard, comparison, bulk inquiry, SEO, hardening, backup, deployment | |

## 6. Risiko

- **MinIO.** Upstream MinIO menghentikan distribusi image/binary community; repository
  `minio/minio` sudah tidak ada di Docker Hub. Development memakai `cgr.dev/chainguard/minio`
  (build dari source AGPLv3, di-pin dengan digest). Sebelum production perlu diputuskan: tetap
  MinIO (build sendiri/vendor, perhatikan lisensi AGPLv3) atau object storage S3-compatible lain.
  Kode memakai S3 API, sehingga penggantian cukup lewat konfigurasi.
- **Kualitas data katalog** (lihat bagian 2): perlu review admin sebelum publikasi; foto produk
  belum diekstrak dan perlu di-upload melalui admin.
- **Konten dari pihak lain** di dalam PDF (logo/teks PT Tahta Kasih Karunia) — perlu kejelasan hak
  pakai materi/foto katalog.

## 7. Informasi yang dibutuhkan dari pemilik proyek

1. Konfirmasi kontak resmi. Katalog mencantumkan telepon **0813 1355 3464**,
   **admin@trustoneindonesia.com**, **www.trustoneindonesia.com**, dan alamat Comersio BSD City,
   Latinos Business District Block C 9 No. 9, Serpong, Tangerang Selatan 15318. Apakah nomor itu
   juga nomor WhatsApp bisnis? (Saat ini settings masih kosong/placeholder.)
2. Logo resmi dan brand guideline.
3. Status materi PT Tahta Kasih Karunia di katalog (logo terlihat di hlm. 48–50): apakah boleh
   dipakai, dan apakah produk tersebut memang dijual Trustone?
4. Format nomor inquiry dan quotation (usulan sementara: `INQ-2026-000123`, `QUO-2026-000045`).
5. Template resmi, syarat & ketentuan quotation, PPN (dimasukkan atau tidak), mata uang selain IDR.
6. Masa berlaku default quotation (sementara 14 hari, dapat diubah di settings).
7. Kebijakan tampil harga publik (default: tidak) dan informasi ketersediaan stok.
8. Akun admin awal dan prosedur pembuatan password.
9. Batas ukuran/format upload (usulan: gambar JPEG/PNG/WebP ≤ 5 MB, dokumen PDF ≤ 20 MB).
10. Domain dan hosting production.
11. Keputusan per temuan data: SKU duplikat, judul duplikat, deskripsi tersalin (daftar lengkap di
    `review_notes`).

### Keputusan yang sudah dijawab (21 November 2026)

| No | Topik | Keputusan |
|---|---|---|
| 1 | Kontak resmi / WhatsApp bisnis | Pakai data **dummy** dulu, ditandai jelas sebagai dummy, mudah diganti di settings |
| 4 | Format nomor | Disetujui: `INQ-2026-000123` dan `QUO-2026-000045` |
| 5 | PPN | **Tidak** memakai PPN untuk saat ini |
| 8–9 | Admin awal & batas upload | Disetujui usulan: gambar JPEG/PNG/WebP ≤ 5 MB, dokumen PDF ≤ 20 MB; akun admin awal dibuat lewat script dengan password dari input/env |
