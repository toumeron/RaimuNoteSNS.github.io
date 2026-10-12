export const SUSPENSION_EVENT = 'lime-account-suspended-action';
export const SUSPENSION_MESSAGE = 'あなたのアカウントは停止されているため、この操作は許可されていません。';
let suspended = false;
export function setAccountSuspended(value: boolean) { suspended = value; }
export function isAccountReadOnly() { return suspended; }
export function allowAccountWrite() { if (!suspended) return true; notifySuspendedAction(); return false; }
export function notifySuspendedAction() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SUSPENSION_EVENT));
}
// POST is also used for read-only RPCs and private-media resolution.
const readRpc = /^(get_|list_|can_|is_|has_|resolve_|count_)/;
const readFunctions = new Set(['link-preview', 'recommendation-ranker', 'get-trends', 'friend-images']);
export function createSuspensionFetch(baseUrl: string, transport: typeof fetch): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let blocked = suspended && url.origin === origin && url.pathname.startsWith('/rest/v1/') &&
      [...url.searchParams.values()].some(value => /(?:^|\.)(?:i?like|(?:p|ph|w)?fts)\./.test(value));
    if (suspended && url.origin === origin && !['GET','HEAD','OPTIONS'].includes(method)) {
      blocked = true;
      if (url.pathname.startsWith('/auth/v1/')) blocked = !/\/(token|logout)$/.test(url.pathname);
      if (url.pathname.startsWith('/rest/v1/rpc/')) blocked = !readRpc.test(url.pathname.split('/').pop() ?? '');
      if (url.pathname.startsWith('/functions/v1/')) {
        const name = url.pathname.split('/').pop() ?? '';
        blocked = !readFunctions.has(name);
        if (['direct-media','poll-media','list-media'].includes(name)) {
          try {
            const body = input instanceof Request && init?.body === undefined ? await input.clone().json() : JSON.parse(String(init?.body));
            blocked = !['read','resolve'].includes(body.action);
          } catch { blocked = true; }
        }
      }
    }
    if (blocked) {
      notifySuspendedAction();
      return Response.json({code:'ACCOUNT_SUSPENDED', message:SUSPENSION_MESSAGE, error:SUSPENSION_MESSAGE}, {status:403});
    }
    const response = await transport(input, init);
    if (response.status === 403 || response.status === 400) {
      const body = await response.clone().text().catch(() => '');
      if (body.includes('ACCOUNT_SUSPENDED')) notifySuspendedAction();
    }
    return response;
  };
}
