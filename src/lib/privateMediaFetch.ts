/** Persist storage references, never public URLs for newly attached post media. */
export const POST_MEDIA_BUCKET = 'post-media';
export const MEDIA_PREFIX = `storage://${POST_MEDIA_BUCKET}/`;
const localMedia = new Set<string>();
const mediaByReference = new Map<string,string>();
let generation = 0;

export function clearPrivateMedia(): void {
  generation++;
  for (const url of localMedia) URL.revokeObjectURL(url);
  localMedia.clear();
  mediaByReference.clear();
}

/** Hydrate nested PostgREST results, including quotes, replies and profile feeds.
 * Download through Storage RLS with the request's credentials. No transferable
 * signed URL or persistent HTTP cache is created for restricted attachments.
 */
export function createPrivateMediaFetch(baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const epoch = generation;
    const response = await transport(input, init);
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl);
    const isRest = url.origin === origin && url.pathname.startsWith('/rest/v1/');
    const changed = () => Response.json({code: 'SESSION_CHANGED', message: 'Account changed during request'}, {status: 409, headers: {'Cache-Control': 'no-store'}});
    if (isRest && epoch !== generation) return changed();
    if (!isRest || !response.ok ||
        !response.headers.get('content-type')?.includes('json') || response.status === 204 || init?.method === 'HEAD') return response;
    const body = await response.clone().json().catch(() => null);
    if (!body || !JSON.stringify(body).includes(MEDIA_PREFIX)) return response;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const credentials = new Headers();
    for (const key of ['authorization', 'apikey']) {
      const value = headers.get(key);
      if (value) credentials.set(key, value);
    }
    const downloads = new Map<string, Promise<string | null>>();
    const resolve = (ref: string) => {
      if (!downloads.has(ref)) downloads.set(ref, (async () => {
        const path = ref.slice(MEDIA_PREFIX.length);
        if (!/^[\da-f-]{36}\/[\da-f-]{36}\/[\da-f-]{36}\.(png|jpg|webp|gif|avif)$/i.test(path)) return null;
        const asset = await transport(`${origin}/storage/v1/object/authenticated/${POST_MEDIA_BUCKET}/${path}`, {
          headers: credentials, cache: 'no-store', redirect: 'error', signal: init?.signal,
        }).catch(() => null);
        if (!asset?.ok || !/^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(asset.headers.get('content-type') || '')) return null;
        // Revalidate RLS on each response, reuse the immutable image bytes only
        // after Storage approves this viewer again. Avoid accumulating another
        // Blob for the same attachment on every timeline refresh.
        const cached = mediaByReference.get(ref);
        if (cached && epoch === generation) { await asset.body?.cancel(); return cached; }
        const blob = await asset.blob();
        if (epoch !== generation) return null;
        const local = URL.createObjectURL(blob);
        localMedia.add(local);
        mediaByReference.set(ref,local);
        return local;
      })());
      return downloads.get(ref)!;
    };
    const hydrate = async (value: unknown): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map(hydrate));
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => {
        if ((key === 'image_urls' || key === 'imageUrls') && Array.isArray(item)) {
          const images = await Promise.all(item.map(ref => typeof ref === 'string' && ref.startsWith(MEDIA_PREFIX) ? resolve(ref) : ref));
          return [key, images.filter(ref => ref !== null)];
        }
        return [key, await hydrate(item)];
      })));
    };
    const hydrated = await hydrate(body);
    if (epoch !== generation) return changed();
    const resultHeaders = new Headers(response.headers);
    resultHeaders.delete('content-length');
    resultHeaders.delete('content-encoding');
    resultHeaders.set('cache-control', 'no-store');
    return new Response(JSON.stringify(hydrated), {status: response.status, statusText: response.statusText, headers: resultHeaders});
  };
}
