// Tiny, dependency-free helper to read the `email` claim out of a signed-in
// account's JWT for display/prefill purposes (e.g. "Signed in as ___",
// pre-filling the booking form's email field). This never needs to verify
// the token -- the backend independently decodes and verifies the same
// token server-side (see adar-core/api/routes/scheduling_guest.py's
// get_scheduling_customer) before it ever trusts the email for anything
// that matters (sending a confirmation, attributing a booking). No atob/
// Buffer dependency -- neither is guaranteed present under Hermes.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let bytes = '';
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    if (char === '=') break;
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(
      bytes
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return bytes;
  }
}

export function decodeJwtEmail(token: string | null | undefined): string {
  if (!token) return '';
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return typeof payload?.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}
