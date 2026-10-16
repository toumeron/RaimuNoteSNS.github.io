export {MARKET_ASSETS,MARKET_RANGES,matchMarketAsset,suggestMarketAssets} from "./../../supabase/functions/market-data/http.ts";
export type {MarketAsset,MarketRange,MarketQuote,MarketPoint} from "./../../supabase/functions/market-data/http.ts";
import type { MarketRange, MarketQuote } from "./../../supabase/functions/market-data/http.ts";
export async function getMarketQuote(symbol:string,range:MarketRange,signal?:AbortSignal):Promise<MarketQuote>{
 const url=new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-data`);
 url.search=new URLSearchParams({symbol,range}).toString();
 const response=await fetch(url,{signal});if(!response.ok)throw new Error('Market data unavailable');
 return response.json();
}
export function formatMarketPrice(price:number,currency:string):string{
 return new Intl.NumberFormat('ja-JP',{style:'currency',currency:currency||'USD',minimumFractionDigits:currency==='JPY'?0:2,maximumFractionDigits:2}).format(price);
}
