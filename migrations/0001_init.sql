-- 0001_init.sql
-- Initial schema for the Trustone digital catalog & quotation system.
-- Forward-only migration. Money uses NUMERIC, never floating point.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Users (admin panel). Only role 'admin' for now; extend the CHECK later.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  email          text NOT NULL CHECK (position('@' IN email) > 1),
  password_hash  text NOT NULL,
  role           text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Files stored in object storage (MinIO). Binary content never lives here.
-- ---------------------------------------------------------------------------
CREATE TABLE files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name    text NOT NULL,
  object_key       text NOT NULL,
  bucket           text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256  text,
  visibility       text NOT NULL CHECK (visibility IN ('public', 'private')),
  status           text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready')),
  uploaded_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key)
);

-- ---------------------------------------------------------------------------
-- Catalog: categories, brands, products
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description    text,
  image_file_id  uuid REFERENCES files (id) ON DELETE SET NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_active_sort_idx ON categories (is_active, sort_order);
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE brands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_file_id  uuid REFERENCES files (id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brands_name_lower_uq ON brands (lower(name));
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- specs: ordered JSON array of {"key": text, "value": text | text[]}.
--   An array keeps the display order of the catalog (JSONB objects do not),
--   and `specs @> '[{"key":"Material","value":"ABS"}]'` stays indexable (GIN).
-- source_page / needs_review / review_notes / import_key support the reviewed
--   import of catalog PDF data: imported rows start as 'draft' + needs_review.
CREATE TABLE products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (length(btrim(name)) > 0),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku                  text CHECK (sku IS NULL OR length(btrim(sku)) > 0),
  brand_id             uuid REFERENCES brands (id) ON DELETE RESTRICT,
  category_id          uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  short_description    text,
  description          text,
  specs                jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(specs) = 'array'),
  availability_status  text,
  is_featured          boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at         timestamptz,
  source_page          integer CHECK (source_page IS NULL OR source_page > 0),
  needs_review         boolean NOT NULL DEFAULT false,
  review_notes         text[] NOT NULL DEFAULT '{}',
  import_key           text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
-- SKU unique only when present (and not soft-deleted). Case-insensitive.
CREATE UNIQUE INDEX products_sku_uq ON products (lower(sku)) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX products_public_idx ON products (status, category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_brand_idx ON products (brand_id);
CREATE INDEX products_featured_idx ON products (is_featured) WHERE is_featured AND deleted_at IS NULL;
CREATE INDEX products_specs_gin ON products USING gin (specs jsonb_path_ops);
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  sku         text CHECK (sku IS NULL OR length(btrim(sku)) > 0),
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id, sort_order);
CREATE UNIQUE INDEX product_variants_sku_uq ON product_variants (lower(sku)) WHERE sku IS NOT NULL;
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  alt_text    text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, file_id)
);
CREATE UNIQUE INDEX product_images_one_primary_uq ON product_images (product_id) WHERE is_primary;
CREATE INDEX product_images_product_idx ON product_images (product_id, sort_order);

CREATE TABLE product_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  file_id        uuid NOT NULL REFERENCES files (id) ON DELETE RESTRICT,
  title          text NOT NULL CHECK (length(btrim(title)) > 0),
  document_type  text NOT NULL DEFAULT 'other'
                 CHECK (document_type IN ('datasheet', 'manual', 'certificate', 'other')),
  is_public      boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, file_id)
);
CREATE INDEX product_documents_product_idx ON product_documents (product_id, sort_order);

CREATE TABLE product_related (
  product_id          uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  related_product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sort_order          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, related_product_id),
  CHECK (product_id <> related_product_id)
);

-- ---------------------------------------------------------------------------
-- Human-readable document numbers (inquiry / quotation). The format is still
-- undecided by the business, so numbering is generated in the api from a
-- configurable pattern; this table only provides concurrency-safe counters.
-- ---------------------------------------------------------------------------
CREATE TABLE document_counters (
  scope       text NOT NULL,   -- e.g. 'inquiry', 'quotation'
  period      text NOT NULL,   -- e.g. '2026' or '202611'
  last_value  integer NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (scope, period)
);

-- ---------------------------------------------------------------------------
-- Inquiries (customer "Daftar Permintaan")
-- ---------------------------------------------------------------------------
CREATE TABLE inquiries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code       text NOT NULL UNIQUE,
  customer_name        text NOT NULL CHECK (length(btrim(customer_name)) > 0),
  company_name         text,
  whatsapp_number      text NOT NULL CHECK (whatsapp_number ~ '^\+?[0-9]{8,16}$'),
  email                text CHECK (email IS NULL OR position('@' IN email) > 1),
  general_note         text,
  internal_note        text,   -- admin only, never returned by public endpoints
  status               text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'contacted', 'in_discussion', 'quoted', 'closed', 'cancelled')),
  tracking_token_hash  bytea UNIQUE,  -- reserved for optional inquiry tracking
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiries_status_created_idx ON inquiries (status, created_at DESC);
CREATE INDEX inquiries_created_idx ON inquiries (created_at DESC);
CREATE TRIGGER inquiries_set_updated_at BEFORE UPDATE ON inquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inquiry_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id             uuid NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
  product_id             uuid REFERENCES products (id) ON DELETE SET NULL,
  variant_id             uuid REFERENCES product_variants (id) ON DELETE SET NULL,
  product_name_snapshot  text NOT NULL,
  sku_snapshot           text,
  variant_name_snapshot  text,
  quantity               integer NOT NULL CHECK (quantity > 0),
  customer_note          text,
  sort_order             integer NOT NULL DEFAULT 0
);
CREATE INDEX inquiry_items_inquiry_idx ON inquiry_items (inquiry_id, sort_order);
CREATE INDEX inquiry_items_product_idx ON inquiry_items (product_id);

-- ---------------------------------------------------------------------------
-- Quotations
-- A published quotation is never edited commercially: a revision is a new row
-- with parent_quotation_id pointing to the previous one.
-- ---------------------------------------------------------------------------
CREATE TABLE quotations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id           uuid NOT NULL REFERENCES inquiries (id) ON DELETE RESTRICT,
  parent_quotation_id  uuid REFERENCES quotations (id) ON DELETE RESTRICT,
  revision_number      integer NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  quotation_number     text NOT NULL UNIQUE,
  public_token_hash    bytea UNIQUE,  -- SHA-256 of the random public token; raw token is never stored
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'sent', 'accepted', 'revision_requested', 'rejected', 'expired', 'cancelled')),
  currency             char(3) NOT NULL DEFAULT 'IDR',
  valid_until          date,
  customer_name        text NOT NULL,
  company_name         text,
  whatsapp_number      text,
  email                text,
  notes                text,
  terms                text,
  internal_note        text,   -- admin only
  subtotal             numeric(18, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total       numeric(18, 2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  grand_total          numeric(18, 2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  published_at         timestamptz,
  revoked_at           timestamptz,
  responded_at         timestamptz,
  created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR published_at IS NOT NULL OR status = 'cancelled'),
  CHECK (status = 'draft' OR valid_until IS NOT NULL OR status = 'cancelled')
);
CREATE INDEX quotations_inquiry_idx ON quotations (inquiry_id, revision_number);
CREATE INDEX quotations_status_idx ON quotations (status, created_at DESC);
CREATE TRIGGER quotations_set_updated_at BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quotation_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id           uuid NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
  product_id             uuid REFERENCES products (id) ON DELETE SET NULL,
  product_name_snapshot  text NOT NULL,
  sku_snapshot           text,
  description            text,
  unit                   text,
  quantity               integer NOT NULL CHECK (quantity > 0),
  unit_price             numeric(18, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_amount        numeric(18, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total             numeric(18, 2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  sort_order             integer NOT NULL DEFAULT 0
);
CREATE INDEX quotation_items_quotation_idx ON quotation_items (quotation_id, sort_order);

CREATE TABLE quotation_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id   uuid NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
  response_type  text NOT NULL CHECK (response_type IN ('accepted', 'revision_requested', 'rejected')),
  customer_note  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotation_responses_quotation_idx ON quotation_responses (quotation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit trail for important changes (quotation lifecycle, inquiry status, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type    text NOT NULL,
  entity_id      uuid NOT NULL,
  action         text NOT NULL,
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_type     text NOT NULL DEFAULT 'admin' CHECK (actor_type IN ('admin', 'customer', 'system')),
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Website settings (key/value). Official values are filled by the admin.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
