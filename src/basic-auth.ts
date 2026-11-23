export interface BasicAuthOptions {
  /** Default: process.env.SERPDINO_ADMIN_USER or "admin". */
  user?: string;
  /** Default: process.env.SERPDINO_ADMIN_PASSWORD. Without a password every request is refused. */
  password?: string;
  realm?: string;
}

/**
 * Checks HTTP Basic Auth on a request. Returns `null` when the request may pass,
 * or a 401 `Response` that makes the browser ask for a login.
 * Works with standard Request/Response, so it fits Next.js `proxy.js` / `middleware.js`.
 *
 * ```js
 * // proxy.js (Next.js 16) or middleware.js
 * import { checkBasicAuth } from '@alexsandr-pr/serpdino-positions';
 * export function proxy(request) { return checkBasicAuth(request) ?? undefined; }
 * export const config = { matcher: ['/admin/:path*'] };
 * ```
 */
export function checkBasicAuth(request: Request, options: BasicAuthOptions = {}): Response | null {
  const user = options.user ?? env('SERPDINO_ADMIN_USER') ?? 'admin';
  const password = options.password ?? env('SERPDINO_ADMIN_PASSWORD');
  const realm = options.realm ?? 'Admin';

  if (password) {
    const header = request.headers.get('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = decodeBase64(encoded);
      const separator = decoded.indexOf(':');
      if (separator !== -1 && safeEqual(decoded.slice(0, separator), user) && safeEqual(decoded.slice(separator + 1), password)) {
        return null;
      }
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
  });
}

function decodeBase64(value: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
  } catch {
    return '';
  }
}

/** Length-independent comparison so the check time does not leak the password. */
function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] || undefined : undefined;
}
