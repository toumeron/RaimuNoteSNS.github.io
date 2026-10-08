import { supabase } from '@/lib/supabase';
import { getClientName } from '@/lib/clientName';

export type AccountAbout = {
  user_id: string;
  country_code: string | null;
  connection_source: string | null;
  connection_updated_at: string | null;
  username_change_count: number;
  last_username_change_at: string | null;
  tracking_since: string;
};
export const accountAboutKey = (id: string) => ['account-about', id] as const;

export async function getAccountAbout(id: string): Promise<AccountAbout | null> {
  const { data, error } = await supabase.from('profiles')
    .select('user_id:id,country_code,connection_source,connection_updated_at,username_change_count,last_username_change_at,tracking_since:username_tracking_since')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as AccountAbout | null;
}

export function countryName(code: string | null): string {
  if (!code) return '未取得';
  try { return new Intl.DisplayNames(['ja'], { type: 'region' }).of(code) ?? code; }
  catch { return code; }
}

// The default country.is endpoint returns only IP and country. Do not request
// optional city/location fields, use GPS, or retain the returned IP address.
export async function detectCountry(signal?: AbortSignal): Promise<string | null> {
  // Enable only after approval to send the caller's IP to the country service.
  if (import.meta.env.VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED !== 'true') return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 10000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetch('https://api.country.is/', {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('国情報を取得できませんでした');
    const { country } = await response.json();
    return typeof country === 'string' && /^[A-Z]{2}$/.test(country) &&
      country !== 'XX' ? country : null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function syncAccountConnection(id: string, signal?: AbortSignal): Promise<boolean> {
  if (import.meta.env.VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED !== 'true') return false;
  const existing = await getAccountAbout(id);
  if (signal?.aborted) return false;
  if (existing?.connection_updated_at &&
      Date.now() - Date.parse(existing.connection_updated_at) < 24 * 60 * 60 * 1000) return false;
  const country = await detectCountry(signal);
  if (signal?.aborted || !country) return false;
  const { error } = await supabase.rpc('update_account_connection', {
    expected_user_id: id, country, client: getClientName(),
  });
  if (error) throw error;
  return true;
}
