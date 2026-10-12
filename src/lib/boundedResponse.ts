export class ResponseTooLarge extends Error {
  constructor() { super('画像のサイズが上限を超えています'); }
}

/** Limit actual decompressed bytes, not the untrusted Content-Length header. */
export async function boundedResponseBlob(response: Response, maxBytes: number): Promise<Blob> {
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
