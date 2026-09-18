export const GUEST_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year: 31,536,000 seconds

/**
 * Safely parse Cookie header using null-prototype object to prevent prototype pollution.
 * Protects against URIError when decoding invalid percent-encoding.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = Object.create(null);
  if (!cookieHeader) return list;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    if (!key) continue;
    let val = pair.substring(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    try {
      list[key] = decodeURIComponent(val);
    } catch {
      // Malformed percent-encoding is treated as invalid and ignored; never throws HTTP 500
    }
  }

  return list;
}

/**
 * Serializes guest session cookie with 1-year persistent Max-Age, HttpOnly, Path=/, and SameSite=Lax.
 * When isSecure is true (or in production), sets Secure flag.
 */
export function serializeGuestCookie(token: string, isSecure = false): string {
  const parts = [
    `bf_guest=${token}`,
    'Path=/',
    `Max-Age=${GUEST_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
