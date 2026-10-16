import {handleMarketData} from './http.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('Assertion failed');};
Deno.test('rejects arbitrary upstreams, invalid ranges, methods and origins without fetching',async()=>{
 for(const [query,options,status] of [
  ['symbol=https://example.com&range=1D',{},400],['symbol=AAPL&range=bad',{},400],['symbol=AAPL&range=__proto__',{},400],
  ['symbol=AAPL',{method:'POST'},405],['symbol=AAPL',{headers:{origin:'https://evil.test'}},403],
 ] as const){const response=await handleMarketData(new Request(`https://local.test/?${query}`,options));assert(response.status===status);}
});
Deno.test('serves public cached quotes and supports mobile localhost CORS',async()=>{
 const original=globalThis.fetch;let reads=0;
 globalThis.fetch=async(input)=>{reads++;assert(String(input).startsWith('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?'));return Response.json({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',regularMarketPrice:102,regularMarketTime:30,previousClose:100},timestamp:[10],indicators:{quote:[{close:[102],volume:[1]}]}}]}});};
 try{
  const request=()=>new Request('https://local.test/?symbol=AAPL&range=1D',{headers:{origin:'http://localhost:8080'}});
  const response=await handleMarketData(request());assert(response.status===200);assert(response.headers.get('Access-Control-Allow-Origin')==='http://localhost:8080');assert((await response.json()).price===102);
  assert((await handleMarketData(request())).status===200);assert(reads===1);
  const options=await handleMarketData(new Request('https://local.test/',{method:'OPTIONS',headers:{origin:'https://toumeron.github.io'}}));assert(options.status===200);
 }finally{globalThis.fetch=original;}
});
Deno.test('upstream errors never produce a fabricated quote or successful cache entry',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:429});
 try{const response=await handleMarketData(new Request('https://local.test/?symbol=MSFT'));assert(response.status===502);assert(response.headers.get('Cache-Control')==='no-store');}finally{globalThis.fetch=original;}
});
