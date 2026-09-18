import http from 'node:http';
import crypto from 'node:crypto';
import { parseCookies } from './cookies';

export const MAX_BODY_BYTES = 16 * 1024; // 16 KiB
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60; // 2 hours

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidId(id: string): boolean {
  return typeof id === 'string' && ID_REGEX.test(id);
}

/**
 * Determines whether the request origin is allowed.
 * Supports:
 * 1. Explicit whitelisted origins (allowedOrigins Set).
 * 2. Automatic same-origin detection based on Host and X-Forwarded-Host headers.
 * 3. Mobile/client same-origin requests without Origin (via Referer or Sec-Fetch-Site).
 */
export function isRequestOriginAllowed(
  origin: string | undefined,
  req: http.IncomingMessage,
  allowedOrigins: Set<string>
): boolean {
  const hostHeader = ((req.headers['x-forwarded-host'] as string) || req.headers.host || '').trim();

  if (origin) {
    if (allowedOrigins.has(origin)) return true;
    const cleanOrigin = origin.replace(/\/+$/, '');
    if (allowedOrigins.has(cleanOrigin)) return true;

    // Check same-origin against Host / X-Forwarded-Host
    if (hostHeader) {
      try {
        const originUrl = new URL(origin);
        // Direct host match (domain:port vs domain:port)
        if (originUrl.host.toLowerCase() === hostHeader.toLowerCase()) {
          return true;
        }
        // Match ignoring standard HTTP(S) default ports (80 / 443)
        const hostWithoutPort = hostHeader.replace(/:(80|443)$/, '').toLowerCase();
        const originHostname = originUrl.hostname.toLowerCase();
        const originPort = originUrl.port;
        if ((originPort === '' || originPort === '80' || originPort === '443') && hostWithoutPort === originHostname) {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  // When Origin is absent, check if Referer indicates a same-origin or allowed-origin request
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (allowedOrigins.has(refUrl.origin) || allowedOrigins.has(refUrl.origin.replace(/\/+$/, ''))) {
        return true;
      }
      if (hostHeader) {
        if (refUrl.host.toLowerCase() === hostHeader.toLowerCase()) {
          return true;
        }
        const hostWithoutPort = hostHeader.replace(/:(80|443)$/, '').toLowerCase();
        const refHostname = refUrl.hostname.toLowerCase();
        const refPort = refUrl.port;
        if ((refPort === '' || refPort === '80' || refPort === '443') && hostWithoutPort === refHostname) {
          return true;
        }
      }
    } catch {}
  }

  // Sec-Fetch-Site browser metadata header (supported by modern mobile/desktop browsers)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'same-origin') {
    return true;
  }

  return false;
}

export function parsePagination(url: URL): {
  valid: true;
  limit: number;
  offset: number;
} | {
  valid: false;
  error: string;
} {
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let limit = 20;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
      return { valid: false, error: 'limit must be an integer between 1 and 50' };
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetParam !== null) {
    const parsed = Number(offsetParam);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      return { valid: false, error: 'offset must be a non-negative integer' };
    }
    offset = parsed;
  }

  return { valid: true, limit, offset };
}

export async function readJsonBody(
  req: http.IncomingMessage
): Promise<{ ok: true; data: any } | { ok: false; status: number; code: string; message: string }> {
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload exceeds 16KiB limit'
    };
  }

  return new Promise((resolve) => {
    let bytesReceived = 0;
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.destroy();
        resolve({
          ok: false,
          status: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds 16KiB limit'
        });
      } else {
        chunks.push(chunk);
      }
    };

    const onEnd = () => {
      if (chunks.length === 0) {
        resolve({ ok: true, data: {} });
        return;
      }
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        if (!bodyStr.trim()) {
          resolve({ ok: true, data: {} });
          return;
        }
        const parsed = JSON.parse(bodyStr);
        resolve({ ok: true, data: parsed });
      } catch {
        resolve({
          ok: false,
          status: 400,
          code: 'INVALID_PAYLOAD',
          message: 'Invalid JSON payload'
        });
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', () => {
      resolve({
        ok: false,
        status: 400,
        code: 'REQUEST_ERROR',
        message: 'Error reading request body'
      });
    });
  });
}

/**
 * Safely extracts client IP address from proxy headers or remote socket.
 * Never stores or returns raw IP.
 */
export function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  if (Array.isArray(realIp) && realIp.length > 0 && realIp[0].trim()) {
    return realIp[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Computes risk fingerprint: SHA-256(BF_RISK_SECRET + IP).
 * Raw IP address is never stored or leaked.
 */
export function hashRiskFingerprint(ip: string): string {
  const secret = process.env.BF_RISK_SECRET || 'bf_default_risk_secret_v1';
  return crypto.createHash('sha256').update(secret + ip).digest('hex');
}

/**
 * Generates a coarse device fingerprint from non-sensitive request headers.
 * The raw headers are never persisted; only the keyed digest is used for
 * automatic collusion signals.
 */
export function hashDeviceFingerprint(req: http.IncomingMessage): string {
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  const clientHints = typeof req.headers['sec-ch-ua'] === 'string' ? req.headers['sec-ch-ua'] : '';
  const platform = typeof req.headers['sec-ch-ua-platform'] === 'string' ? req.headers['sec-ch-ua-platform'] : '';
  const language = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : '';
  const secret = process.env.BF_RISK_SECRET || 'bf_default_risk_secret_v1';
  return crypto.createHash('sha256').update(`${secret}${userAgent}|${clientHints}|${platform}|${language}`).digest('hex');
}

/**
 * Verifies admin token supplied via X-Admin-Token header against BF_ADMIN_TOKEN.
 * Uses timingSafeEqual with SHA-256 digests to prevent timing attacks.
 */
export function verifyAdminHeaderToken(providedToken?: string): boolean {
  const envToken = process.env.BF_ADMIN_TOKEN;
  if (!envToken || !providedToken || typeof providedToken !== 'string') return false;

  const bufA = crypto.createHash('sha256').update(providedToken).digest();
  const bufB = crypto.createHash('sha256').update(envToken).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates signed short-term HttpOnly SameSite=Strict bf_admin cookie.
 * Does not expose BF_ADMIN_TOKEN in the cookie or response.
 */
export function generateAdminSessionCookie(isSecure = false): { cookieHeader: string; sessionToken: string } {
  const envToken = process.env.BF_ADMIN_TOKEN || 'fallback_admin_token';
  const expiresAt = Date.now() + ADMIN_COOKIE_MAX_AGE_SECONDS * 1000;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', envToken).update(payload).digest('hex');
  const sessionToken = `${payload}.${signature}`;

  const parts = [
    `bf_admin=${sessionToken}`,
    'Path=/',
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (isSecure) {
    parts.push('Secure');
  }

  return {
    cookieHeader: parts.join('; '),
    sessionToken
  };
}

/**
 * Verifies signed bf_admin session cookie.
 */
export function verifyAdminSessionCookie(cookieHeader?: string): boolean {
  const envToken = process.env.BF_ADMIN_TOKEN;
  if (!envToken || !cookieHeader) return false;

  const cookies = parseCookies(cookieHeader);
  const token = cookies['bf_admin'];
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expiresAtStr, nonce, signature] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false; // Expired
  }

  const payload = `${expiresAtStr}.${nonce}`;
  const expectedSignature = crypto.createHmac('sha256', envToken).update(payload).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}
