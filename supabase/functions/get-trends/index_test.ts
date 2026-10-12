import {handleTrends} from './index.ts';
Deno.test('trends rejects oversized and malformed input before upstream requests',async()=>{
 const original=fetch;let requests=0;
 globalThis.fetch=(()=>{requests++;throw Error('Unexpected upstream request');}) as typeof fetch;
 try{
  for(const body of ['x'.repeat(5000),'not json']){
   const response=await handleTrends(new Request('https://edge.test',{method:'POST',body}));
   if(response.status!==400)throw Error(String(response.status));
  }
  if(requests)throw Error('Invalid input performed upstream work');
 }finally{globalThis.fetch=original;}
});
