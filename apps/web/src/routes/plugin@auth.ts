// src/routes/plugin@auth.ts
import { QwikAuth$ } from '@auth/qwik';
import Credentials from '@auth/qwik/providers/credentials';

// In the browser, `process` is undefined. Guard accesses so importing this file on the client
// (for hooks like useSession) does not throw at module-evaluation time.
const RAW_GATEWAY = (() => {
  const hasProc = typeof process !== 'undefined';
  const envGw = hasProc ? (process.env?.GATEWAY_URL || '') : '';
  const inDocker = hasProc && process.env?.DOCKER_TRAEFIK === '1';
  if (envGw) return envGw;
  return inDocker ? 'http://gateway:7000' : 'http://127.0.0.1:7000';
})();
const GATEWAY = RAW_GATEWAY.includes('localhost') ? RAW_GATEWAY.replace('localhost', '127.0.0.1') : RAW_GATEWAY;

function pickGatewayTokenFromSetCookie(headers: Headers): string | null {
  // Find "session=..." in the first Set-Cookie header (your gateway sets it)
  const set = headers.get('set-cookie'); // e.g. session=eyJhbGciOi...; Path=/; HttpOnly; SameSite=Lax
  if (!set) return null;
  const part = set.split(';').find(p => p.trim().startsWith('session='));
  return part ? decodeURIComponent(part.trim().slice('session='.length)) : null;
}

export const { onRequest, useSession, useSignIn, useSignOut } = QwikAuth$(() => ({
  debug: !!import.meta.env.DEV,
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      // ← Auth.js calls this on the server
      authorize: async (creds) => {
        const res = await fetch(new URL('/api/auth/login', GATEWAY), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ username: (creds as any)?.username, password: (creds as any)?.password }),
        });

        if (!res.ok) {
          // Dev-friendly debug: log status and response body to server console so devs can see why login failed.
          try {
            const text = await res.text().catch(() => '');
            if (import.meta.env.DEV) {
              const logPayload = { status: res.status, body: text, username: (creds as any)?.username };
              if (res.status === 401) {
                console.info('[auth:authorize] gateway login failed (invalid credentials)', logPayload);
              } else {
                console.error('[auth:authorize] gateway login failed', logPayload);
              }
            }
          } catch (err) {
            // best-effort logging failure should not block authorize
            if (import.meta.env.DEV) console.error('[auth:authorize] failed to log error body', err);
          }
          return null; // -> error=CredentialsSignin (expected on bad creds)
        }

        // Your gateway replies: { userId, email } and sets Set-Cookie: session=<JWT>
        const data = await res.json().catch(() => ({}));
        const token = pickGatewayTokenFromSetCookie(res.headers); // <- gateway JWT

        // Return user; we’ll lift the gateway token into the Auth.js JWT in callbacks below
        return {
          id: data.userId ?? 'unknown',
          email: data.email ?? '',
          gatewayToken: token ?? null,
        } as any;
      },
    }),
  ],
  // Quiet noisy Credential errors in dev so UI can handle them gracefully
  logger: {
    error(evt: any, ...rest: any[]) {
      const code = typeof evt === 'string' ? evt : (evt?.code || evt?.type || evt?.name);
      // CredentialsSignin is expected for wrong password; avoid scary stack in dev
      if (code === 'CredentialsSignin' || code === 'credentials') {
        if (import.meta.env.DEV) console.info('[auth][warn] CredentialsSignin (invalid credentials)');
        return;
      }
      // Minimal error output without passing Error objects to console (avoids stack dumps)
      const msg = (typeof evt === 'object' && (evt?.message || evt?.error || evt?.cause)) || rest?.[0]?.message || '';
      console.error('[auth][error]', code || 'unknown', typeof msg === 'string' ? msg : '');
    },
    warn(evt: any, ...rest: any[]) {
      if (!import.meta.env.DEV) return;
      const code = typeof evt === 'string' ? evt : (evt?.code || evt?.type || evt?.name);
      console.warn('[auth][warn]', code || evt || '', rest?.[0]?.message || '');
    },
    debug(evt: any, ...rest: any[]) {
      if (!import.meta.env.DEV) return;
      const code = typeof evt === 'string' ? evt : (evt?.code || evt?.type || evt?.name);
      console.debug('[auth][debug]', code || evt || '', rest?.[0]?.message || '');
    },
  },
  callbacks: {
    // Persist the gateway JWT in Auth.js' own JWT and fetch the user's role (if available).
    // We attempt to fetch /api/auth/me server-side when we have a gateway token so role can be
    // stored in the Auth.js JWT and exposed to the client session.
    async jwt({ token, user }) {
      // If we just signed in, the provider attached the gateway token on `user`.
      if (user && (user as any).gatewayToken) {
        token.gateway = (user as any).gatewayToken; // store for later
      }

      // If we have a gateway token but no role saved in the JWT, try to fetch /api/auth/me
      // server-side to enrich the token with the user's role.
      try {
        const gw = (token as any).gateway;
        if (gw && !(token as any).role) {
          // Use the configured gateway base to call the backend
          const base = (() => {
            const hasProc = typeof process !== 'undefined';
            const envGw = hasProc ? (process.env?.GATEWAY_URL || '') : '';
            const inDocker = hasProc && process.env?.DOCKER_TRAEFIK === '1';
            const raw = envGw || (inDocker ? 'http://gateway:7000' : 'http://127.0.0.1:7000');
            return raw.replace('localhost', '127.0.0.1');
          })();
          const res = await fetch(new URL('/api/auth/me', base).toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${gw}`,
            },
          });
          if (res.ok) {
            const json = await res.json().catch(() => null);
            const role = json?.role ?? (json?.user && json.user.role) ?? null;
            if (role) {
              (token as any).role = role;
            }
          }
        }
      } catch (err) {
        // best-effort: do not fail sign-in if role fetch fails
        console.debug('jwt callback: failed to enrich role', err);
      }

      return token;
    },
    // Expose gateway token and role to the client session for fetches / UI
    async session({ session, token }) {
      (session as any).gateway = (token as any).gateway ?? null;
      (session as any).role = (token as any).role ?? null;
      return session;
    },
    // Restrictive redirect sanitizer: allow only a small whitelist of same-origin paths to avoid loops.
    async redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        // Enforce same-origin; otherwise land on app home (then our logic will further route)
        if (u.origin !== baseUrl) return new URL('/profile', baseUrl).toString();
        const p = u.pathname || '/';
        // Normalize trailing slash (treat '/profile/' == '/profile')
        const norm = p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
        // Default: if root is requested, land on profile
        if (norm === '/') return new URL('/profile/', baseUrl).toString();
        // Allow explicit navigations to login (e.g., after signOut)
        if (norm === '/login' || norm.startsWith('/login')) return u.toString();
        // Allow common in-app destinations
        if (norm === '/profile' || norm === '/profile/' || norm.startsWith('/admin')) return u.toString();
      } catch {
        // fall through
      }
      // Safe default: land authenticated users on profile
      return new URL('/profile/', baseUrl).toString();
    },
  },
}));
