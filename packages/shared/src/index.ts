export const sharedVersion = '0.0.0';

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_GATEWAY = 'http://127.0.0.1:7000';

export function getGatewayBase(): string {
  return (typeof process !== 'undefined' && process.env?.GATEWAY_URL) || DEFAULT_GATEWAY;
}

export async function ping(): Promise<ApiResponse<{ status: string }>> {
  const base = getGatewayBase();
  try {
    const res = await fetch(`${base}/api/health`).catch(() => fetch(`${base}/health`).catch(() => null));
    if (!res) return { ok: false, error: 'unreachable' };
    const data = await res.json().catch(() => ({ status: res.ok ? 'ok' : 'error' }));
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- auth (shared) ---
export interface SignupInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function checkUsername(u: string): Promise<ApiResponse<{ available: boolean }>> {
  const base = getGatewayBase();
  try {
    const url = new URL('/api/auth/check_username', base);
    url.searchParams.set('u', u);
    const res = await fetch(url);
    const data = await res.json();
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function signup(input: SignupInput): Promise<ApiResponse<{ id?: string }>> {
  const base = getGatewayBase();
  try {
    const res = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    const isJSON = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJSON ? await res.json().catch(() => ({})) : {};
    if (!res.ok) return { ok: false, error: (data?.message || data?.error || `status ${res.status}`) };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function login(input: LoginInput): Promise<ApiResponse<{ token?: string }>> {
  const base = getGatewayBase();
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    const isJSON = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJSON ? await res.json().catch(() => ({})) : {};
    if (!res.ok) return { ok: false, error: (data?.message || data?.error || `status ${res.status}`) };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getSession(): Promise<ApiResponse<{ user?: { email?: string; username?: string; role?: string } }>> {
  const base = getGatewayBase();
  try {
    const res = await fetch(`${base}/api/auth/session`, { headers: { Accept: 'application/json' } });
    const isJSON = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJSON ? await res.json().catch(() => ({})) : {};
    return { ok: res.ok, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- design tokens ---
export const tokens = {
  colors: {
    bg: '#0b0f17',
    surface: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.08)',
    primary: '#5865F2',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.7)'
  },
  radius: {
    md: 12,
    lg: 16,
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24
  }
} as const;

