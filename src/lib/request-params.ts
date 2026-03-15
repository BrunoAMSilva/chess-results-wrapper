const VALID_LANGS = new Set([0, 1, 2, 10, 20]);

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getIntParam(
  value: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const parsed = parseInteger(value);
  if (parsed === null) return defaultValue;
  if (parsed < min || parsed > max) return defaultValue;
  return parsed;
}

export function getLangParam(value: string | null, defaultValue = 1): number {
  const lang = parseInteger(value);
  if (lang === null) return defaultValue;
  return VALID_LANGS.has(lang) ? lang : defaultValue;
}

/**
 * Resolve the public-facing origin from reverse-proxy headers,
 * the ORIGIN env var, or fall back to the Astro request URL.
 */
export function resolvePublicOrigin(request: Request, fallbackOrigin: string): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return `${proto}://${forwardedHost}`;
  }

  const envOrigin = import.meta.env.ORIGIN || process.env.ORIGIN;
  if (envOrigin) return envOrigin.replace(/\/$/, '');

  return fallbackOrigin;
}
