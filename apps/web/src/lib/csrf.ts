export function getCsrfToken(): string | null {
  // Only run in the browser
  if (typeof document === 'undefined') return null;

  const name = 'csrfToken=';
  const parts = document.cookie.split(';').map(p => p.trim());
  const found = parts.find(p => p.startsWith(name));
  if (found) return decodeURIComponent(found.slice(name.length));

  // Generate a 16-byte (128-bit) token and store as hex
  try {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const token = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    // Build cookie attributes
    const attrs = [`Path=/`, `SameSite=Lax`];
    if (location && location.protocol === 'https:') {
      attrs.push('Secure');
    }
    // Set cookie (non-HttpOnly so it can be read by JS for double-submit)
    document.cookie = `csrfToken=${encodeURIComponent(token)}; ${attrs.join('; ')}`;
    return token;
  } catch {
    return null;
  }
}

export function csrfHeader(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}
