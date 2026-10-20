import { randomUUID } from "@/lib/utils";

// privateMediaFetch
/** Persist storage references, never public URLs for newly attached post media. */
const POST_MEDIA_BUCKET = 'post-media';
const MEDIA_PREFIX = `storage://${POST_MEDIA_BUCKET}/`;
const localMedia = new Set<string>();
const mediaByReference = new Map<string,string>();
const deferredMedia = new Map<string,{reference:string;load:()=>Promise<string|null>}>();
const isDeferredPrivateMedia=(url:string)=>url.startsWith('lime-private-media:');
const privateMediaReference=(url:string)=>deferredMedia.get(url)?.reference??url;
async function resolvePrivateMediaUrl(url:string):Promise<string|null>{
  return isDeferredPrivateMedia(url)?deferredMedia.get(url)?.load()??null:url;
}
let generation = 0;

/** Share only overlapping reads. Completed data is never cached across changes
 * to RLS, accounts or writes, and each consumer retains its own cancellation. */
function createSupabaseReadFetch(baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  const origin = new URL(baseUrl).origin;
  type Read = {controller: AbortController; response: Promise<Response>; users: number; cancelSource?: boolean};
  const reads = new Map<string, Read>();
  let writes = 0;
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/')) return transport(input, init);
    if (method !== 'GET' && method !== 'HEAD') {
      writes++;
      return Promise.resolve(transport(input, init)).finally(() => { writes++; });
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const key = JSON.stringify([generation, writes, method, url.href, [...headers], init?.credentials ?? (input instanceof Request ? input.credentials : undefined), init?.cache ?? (input instanceof Request ? input.cache : undefined), init?.redirect ?? (input instanceof Request ? input.redirect : undefined)]);
    let read = reads.get(key);
    if (!read) {
      const controller = new AbortController();
      const response = Promise.resolve().then(() => transport(input, {...init, headers, signal: controller.signal}));
      read = {controller, response, users: 0};
      reads.set(key, read);
      const finished = () => { if (reads.get(key) === read) reads.delete(key); };
      void response.then(finished, finished);
    }
    const shared = read;
    shared.users++;
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', abort);
        shared.users--;
        if (!shared.users) {
          if (reads.get(key) === shared) reads.delete(key);
          shared.controller.abort();
        }
        return true;
      };
      const abort = () => {
        const reason = signal?.reason ?? new DOMException('Aborted', 'AbortError');
        if (!finish()) return;
        bodyController?.error(reason);
        void reader?.cancel(reason).catch(() => {});
        reject(reason);
      };
      signal?.addEventListener('abort', abort, {once: true});
      void shared.response.then(response => {
        if (!settled) {
          const copy = response.clone();
          if (!copy.body) { finish(); resolve(copy); }
          else {
            reader = copy.body.getReader();
            const body = new ReadableStream<Uint8Array>({
              start(controller) { bodyController = controller; },
              async pull(controller) {
                try {
                  const part = await reader!.read();
                  if (settled) return;
                  if (part.done) { finish(); controller.close(); }
                  else controller.enqueue(part.value);
                } catch (error) { if (finish()) controller.error(error); }
              },
              cancel(reason) { finish(); void reader!.cancel(reason).catch(() => {}); },
            });
            resolve(new Response(body, {status: copy.status, statusText: copy.statusText, headers: copy.headers}));
          }
        }
        if (!shared.cancelSource) {
          shared.cancelSource = true;
          // All waiters clone in this microtask before releasing the unused tee.
          void Promise.resolve().then(() => response.body?.cancel()).catch(() => {});
        }
      }, error => { if (finish()) reject(error); });
    });
  };
}

function clearPrivateMedia(): void {
  generation++;
  for (const url of localMedia) URL.revokeObjectURL(url);
  localMedia.clear();
  mediaByReference.clear();
  deferredMedia.clear();
}

/** Hydrate nested PostgREST results, including quotes, replies and profile feeds.
 * Download through Storage RLS with the request's credentials. No transferable
 * signed URL or persistent HTTP cache is created for restricted attachments.
 */
function createPrivateMediaFetch(baseUrl: string, transport: typeof fetch = fetch, deferPostImages = false): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const epoch = generation;
    const response = await transport(input, init);
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl);
    const isRest = url.origin === origin && url.pathname.startsWith('/rest/v1/');
    const deferAttachments=deferPostImages&&/^\/rest\/v1\/(posts|likes|reposts|external_reposts|comments)$/.test(url.pathname);
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
    const deferred = new Map<string,string>();
    const resolve = (ref: string) => {
      if (!downloads.has(ref)) downloads.set(ref, (async () => {
        const path = ref.slice(MEDIA_PREFIX.length);
        if (!/^[\da-f-]{36}\/[\da-f-]{36}\/[\da-f-]{36}(?:--[1-9][0-9]{0,5}x[1-9][0-9]{0,5})?\.(png|jpg|webp|gif|avif)$/i.test(path)) return null;
        const cached = mediaByReference.get(ref);
        const asset = await transport(`${origin}/storage/v1/object/authenticated/${POST_MEDIA_BUCKET}/${path}`, {
          method: cached ? 'HEAD' : 'GET',
          headers: credentials, cache: 'no-store', redirect: 'error', signal: deferAttachments?AbortSignal.timeout(12000):init?.signal,
        }).catch(() => null);
        if (!asset?.ok || !/^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(asset.headers.get('content-type') || '')) return null;
        // Revalidate RLS on each response, reuse the immutable image bytes only
        // after Storage approves this viewer again. Avoid accumulating another
        // Blob for the same attachment on every timeline refresh.
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
          const images = await Promise.all(item.map(ref => {
            if(typeof ref !== 'string'||!ref.startsWith(MEDIA_PREFIX))return ref;
            // Return post metadata immediately. Only a rendered attachment or
            // explicit image analysis downloads bytes, still through Storage RLS.
            if(deferAttachments){
              let token=deferred.get(ref);
              if(!token){token=`lime-private-media:${randomUUID()}`;deferred.set(ref,token);deferredMedia.set(token,{reference:ref,load:()=>epoch===generation?resolve(ref):Promise.resolve(null)});}
              return token;
            }
            return resolve(ref);
          }));
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

// devFunctionFetch
/** Keep local mobile previews same-origin without changing production CORS. */
function createDevFunctionFetch(baseUrl: string, proxyUrl: string, transport: typeof fetch = fetch): typeof fetch {
  const target = new URL('/functions/v1/link-preview', baseUrl);
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== target.origin || url.pathname !== target.pathname) return transport(input, init);
    const local = proxyUrl + url.search;
    if (!(input instanceof Request)) return transport(local, init);
    const request = new Request(local, {
      method: input.method,
      headers: input.headers,
      body: input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.clone().arrayBuffer(),
      signal: input.signal,
      credentials: input.credentials,
      cache: input.cache,
      redirect: input.redirect,
    });
    return transport(request, init);
  };
}

// boundedResponse
class ResponseTooLarge extends Error {
  constructor() { super('画像のサイズが上限を超えています'); }
}

/** Limit actual decompressed bytes, not the untrusted Content-Length header. */
async function boundedResponseBlob(response: Response, maxBytes: number): Promise<Blob> {
  if (!response.body) return new Blob([], {type: response.headers.get('content-type') ?? ''});
  const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];
  let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maxBytes)throw new ResponseTooLarge();
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel(); }
  return new Blob(chunks,{type:response.headers.get('content-type')??''});
}

export { resolvePrivateMediaUrl };
export { clearPrivateMedia };
export { createPrivateMediaFetch };
export { POST_MEDIA_BUCKET };
export { MEDIA_PREFIX };
export { isDeferredPrivateMedia };
export { privateMediaReference };
export { createDevFunctionFetch };
export { boundedResponseBlob };
export { ResponseTooLarge };
export { createSupabaseReadFetch };
