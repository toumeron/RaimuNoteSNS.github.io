// The login return target is restricted to the company site on this origin.
export function companyReturnUrl(value: string | null, origin: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    if (url.pathname !== '/LimeNoteJP' && !url.pathname.startsWith('/LimeNoteJP/')) return null;
    return url.href;
  } catch { return null; }
}
export function returnToCompany(url: string) { window.location.replace(url); }
