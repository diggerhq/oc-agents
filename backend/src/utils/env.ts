/**
 * Env-var parsing helpers. Centralizes the truthy/falsy + PG-SSL idioms
 * so we don't have to repeat the precedence ladder across modules.
 */

/**
 * Parse a boolean environment variable with explicit truthy/falsy values
 * and a default. Honors a precedence ladder of:
 *   '1' | 'true'  → true
 *   '0' | 'false' → false
 *   unset / other → fallback
 *
 * Case-insensitive. Trims surrounding whitespace.
 *
 * @example
 *   parseBoolEnv('COOKIE_SECURE', process.env.NODE_ENV === 'production')
 */
export function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return fallback;
}

/**
 * Parse the PGSSL env var (matches libpq's PGSSLMODE naming) into a
 * node-postgres-compatible `ssl` Pool option.
 *
 * PGSSL values:
 *   'disable' | 'false' | 'off'   → no SSL
 *   'require' | 'true'  | 'on'    → SSL with self-signed accepted (RDS-friendly)
 *   'verify'  | 'verify-full'     → SSL with strict cert verification
 *
 * If unset, defaults are derived from NODE_ENV: 'require' in production,
 * 'disable' otherwise (matches the prior implicit behavior).
 */
export type PgSslConfig = false | { rejectUnauthorized: boolean };

export function parsePgSslConfig(): PgSslConfig {
  const raw = (process.env.PGSSL ?? '').trim().toLowerCase();
  const defaultMode = process.env.NODE_ENV === 'production' ? 'require' : 'disable';
  const mode = raw || defaultMode;

  if (mode === 'disable' || mode === 'false' || mode === 'off') return false;
  if (mode === 'verify' || mode === 'verify-full') return { rejectUnauthorized: true };
  // 'require' | 'true' | 'on' | anything else → SSL but don't verify (RDS default)
  return { rejectUnauthorized: false };
}
