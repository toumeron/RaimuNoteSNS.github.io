/** Profile dates are calendar dates; never parse them as UTC timestamps. */
export function localDateString(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isValidBirthDate(value: string, today = localDateString()): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > today) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function formatProfileBirthDate(value: string): string {
  if (!value || !isValidBirthDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function normalizeProfileWebsite(value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (text.startsWith('/') || text.length > 2048 || /[\s\\]/.test(text) || Array.from(text).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Invalid website');
  // Only allow an omitted scheme on a host, never reinterpret an unsafe scheme.
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  if (!/^https?:\/\//i.test(candidate) || !candidate.split('://')[1]?.split(/[/?#]/)[0].includes('.')) throw new Error('Invalid website');
  const url = new URL(candidate);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) throw new Error('Invalid website');
  const labels = url.hostname.split('.');
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) && labels.every(label => Number(label) <= 255);
  const isDomain = labels.length >= 2 && labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
    && /^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/i.test(labels.at(-1) ?? '');
  if (!isDomain && !isIpv4) throw new Error('Invalid website');
  // Validate with URL, but preserve the user's case and Unicode spelling.
  return candidate;
}
