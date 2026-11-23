/** Escapes LIKE/ILIKE wildcards so user input is matched literally (use with ESCAPE '\'). */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Trims a string; returns null for empty/whitespace-only/undefined values. */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
