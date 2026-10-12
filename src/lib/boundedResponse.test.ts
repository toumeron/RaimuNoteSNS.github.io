import {expect,it} from 'vitest';
import {boundedResponseBlob,ResponseTooLarge} from './boundedResponse';
it('stops and cancels oversized chunked images despite a forged Content-Length',async()=>{
 let cancelled=false,reads=0;
 const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await expect(boundedResponseBlob(new Response(stream,{headers:{'content-type':'image/png','content-length':'1'}}),10)).rejects.toBeInstanceOf(ResponseTooLarge);
 expect(cancelled).toBe(true);expect(reads).toBeLessThanOrEqual(3);
});
it('preserves valid image bytes and MIME type',async()=>{
 const blob=await boundedResponseBlob(new Response('hello',{headers:{'content-type':'image/png'}}),10);
 expect(blob.size).toBe(5);expect(blob.type).toBe('image/png');
});
