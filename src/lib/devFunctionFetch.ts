

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

export { createDevFunctionFetch };
export { boundedResponseBlob };
export { ResponseTooLarge };
