# Catalog data (source: `Katalog_Trustone_Borneo_Indonesia.pdf`)

`extracted/pages-*.json` contains the product data extracted from the 2026 PDF catalog
(PDF pages 3–50; pages 1–2 are cover/table of contents, page 51 is contact info).

**Status: raw extraction, not yet reviewed.** `pnpm catalog:import` loads it into the database
idempotently: every product is created as `status = 'draft'`, `needs_review = true`, with `source_page`,
an `import_key` and the `review_notes` (plus notes about cleared duplicate SKUs and logo-only brands),
so an admin can verify and publish each product. Re-running the import never overwrites admin edits.

## How it was produced

- Strings were copied from the PDF text layer; page renders were used only to decide which text
  belongs to which product card and to read brand logos. Pages 5–7 have no text layer and were read
  from the images (lower confidence).
- Hidden text from another company's layout embedded in the PDF (PT Tahta Kasih Karunia contact
  blocks) was deliberately excluded, as was the Trustone footer.
- Nothing was invented: missing values are `null`; every uncertainty is listed in `review_notes`.

## Record format

| field | meaning |
|---|---|
| `source_page` | PDF page number |
| `category_slug` | one of the 28 seeded category slugs |
| `name` | product name as printed (typo fixes are listed in `review_notes`) |
| `sku` | only when the catalog explicitly labels a code (SKU / Code). Model numbers stay in `name` |
| `brand`, `brand_source` | `text` = printed, `logo` = read from a logo next to the card |
| `short_description` | subtitle/tagline printed under the name |
| `description` | paragraph or bullet list printed for the product |
| `attributes` | key/value specs using the catalog's own labels (value: string or string[]) |
| `variants` | only when the catalog explicitly lists distinct variants |
| `image_hint` | where the product photo is on the page (images are not extracted) |
| `review_notes` | open questions for the admin |

## Summary (402 products)

- 17 products have an explicit code; codes `001` (4 products) and `65800` (2 products) are not unique.
- 342 have a brand (171 of them read from a logo only). 38 distinct brands.
- 254 have a description, 122 have structured attributes, 35 variants in total.
- 8 product names appear more than once (different cards with the same title).
