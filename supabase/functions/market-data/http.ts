

// market
const MARKET_RANGES={ '1D':{range:'1d',interval:'5m'},'1W':{range:'5d',interval:'30m'},'1M':{range:'1mo',interval:'1d'},'1Y':{range:'1y',interval:'1d'},ALL:{range:'max',interval:'1mo'}} as const;
type MarketRange=keyof typeof MARKET_RANGES;
type MarketAsset={symbol:string;name:string;exchange:string;aliases:string[]};
const MARKET_ASSETS:MarketAsset[]=[
 ['AAPL','Apple Inc.','NASDAQ','Apple,アップル'],['MSFT','Microsoft','NASDAQ','マイクロソフト'],['NVDA','NVIDIA','NASDAQ','エヌビディア'],['GOOGL','Alphabet','NASDAQ','Google,グーグル,アルファベット'],['AMZN','Amazon','NASDAQ','アマゾン'],['META','Meta Platforms','NASDAQ','メタ,Facebook'],['TSLA','Tesla','NASDAQ','テスラ'],['AVGO','Broadcom','NASDAQ','ブロードコム'],['AMD','AMD','NASDAQ','アドバンストマイクロデバイセズ'],['NFLX','Netflix','NASDAQ','ネットフリックス'],['ORCL','Oracle','NYSE','オラクル'],['JPM','JPMorgan Chase','NYSE','JPモルガン'],['V','Visa','NYSE','ビザ'],['WMT','Walmart','NASDAQ','ウォルマート'],['BRK-B','Berkshire Hathaway','NYSE','バークシャー'],
 ['7203.T','トヨタ自動車','東証','7203,トヨタ,Toyota'],['6758.T','ソニーグループ','東証','6758,ソニー,Sony'],['9984.T','ソフトバンクグループ','東証','9984,ソフトバンクG,ソフトバンクグループ,SoftBank Group'],['7974.T','任天堂','東証','7974,Nintendo'],['8306.T','三菱UFJフィナンシャル・グループ','東証','8306,三菱UFJ,MUFG'],['6501.T','日立製作所','東証','6501,日立,Hitachi'],['8035.T','東京エレクトロン','東証','8035,Tokyo Electron'],['9983.T','ファーストリテイリング','東証','9983,ユニクロ,Fast Retailing'],
 ['285A.T','キオクシアホールディングス','東証','285A,キオクシア,Kioxia'],
 ['6857.T','アドバンテスト','東証','6857,Advantest'],['6146.T','ディスコ','東証','6146,Disco'],['6920.T','レーザーテック','東証','6920,レーザーテック株式会社,Lasertec'],
 ['7011.T','三菱重工業','東証','7011,三菱重工,Mitsubishi Heavy Industries'],['7012.T','川崎重工業','東証','7012,川崎重工,Kawasaki Heavy Industries'],['7013.T','IHI','東証','7013,石川島播磨重工業'],
 ['9432.T','NTT','東証','9432,日本電信電話'],['9433.T','KDDI','東証','9433,au'],['9434.T','ソフトバンク','東証','9434,SoftBank Corp'],
 ['8316.T','三井住友フィナンシャルグループ','東証','8316,三井住友,SMFG'],['8411.T','みずほフィナンシャルグループ','東証','8411,みずほ,Mizuho'],
 ['6503.T','三菱電機','東証','6503,Mitsubishi Electric'],['6701.T','日本電気','東証','6701,NEC'],['6702.T','富士通','東証','6702,Fujitsu'],['8031.T','三井物産','東証','8031,Mitsui'],['8058.T','三菱商事','東証','8058,Mitsubishi Corporation'],['8001.T','伊藤忠商事','東証','8001,伊藤忠,Itochu'],
 ['4063.T','信越化学工業','東証','4063,信越化学,Shin-Etsu'],['4502.T','武田薬品工業','東証','4502,武田薬品,Takeda'],['4519.T','中外製薬','東証','4519,Chugai'],['4568.T','第一三共','東証','4568,Daiichi Sankyo'],
 ['6098.T','リクルートホールディングス','東証','6098,リクルート,Recruit'],['6861.T','キーエンス','東証','6861,Keyence'],['8766.T','東京海上ホールディングス','東証','8766,東京海上,Tokio Marine'],
 ['2914.T','日本たばこ産業','東証','2914,JT,Japan Tobacco'],['4661.T','オリエンタルランド','東証','4661,OLC'],['8136.T','サンリオ','東証','8136,Sanrio'],['7832.T','バンダイナムコホールディングス','東証','7832,バンダイナムコ,バンナム,Bandai Namco'],['9697.T','カプコン','東証','9697,Capcom'],['9766.T','コナミグループ','東証','9766,コナミ,Konami'],
 ['7267.T','本田技研工業','東証','7267,ホンダ,Honda'],['6902.T','デンソー','東証','6902,Denso'],['6273.T','SMC','東証','6273'],
 ['^N225','日経平均株価','指数','日経,日経225,Nikkei'],['^GSPC','S&P 500','指数','S&P500,SP500'],['^DJI','NYダウ','指数','ダウ,Dow Jones'],['^IXIC','NASDAQ総合','指数','ナスダック,NASDAQ'],
].map(([symbol,name,exchange,aliases])=>({symbol,name,exchange,aliases:aliases.split(',')}));
const normalized=(value:string)=>value.normalize('NFKC').trim().replace(/^\$/,'').toLowerCase();
function matchMarketAsset(query:string):MarketAsset|undefined{
 const text=normalized(query);return MARKET_ASSETS.find(asset=>[asset.symbol,asset.name,...asset.aliases].some(value=>normalized(value)===text));
}
function suggestMarketAssets(query:string):MarketAsset[]{
 const text=normalized(query);if(!text||text.length<2&&!query.trim().startsWith('$'))return [];
 const exact=matchMarketAsset(query);
 return [...(exact?[exact]:[]),...MARKET_ASSETS.filter(asset=>asset!==exact&&[asset.symbol,asset.name,...asset.aliases].some(value=>normalized(value).includes(text)))].slice(0,3);
}
type MarketPoint={time:number;price:number;volume:number;extended:boolean};
type MarketQuote={symbol:string;name:string;currency:string;exchange:string;price:number;previousClose:number|null;change:number|null;changePercent:number|null;asOf:number;points:MarketPoint[];extended?:{price:number;time:number};range:MarketRange};
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
function parseMarketChart(input:any,asset:MarketAsset,range:MarketRange):MarketQuote{
 const result=input?.chart?.result?.[0],meta=result?.meta,price=number(meta?.regularMarketPrice),asOf=number(meta?.regularMarketTime);
 if(!meta||meta.symbol!==asset.symbol||price===null||asOf===null)throw new Error('Market data unavailable');
 const previousClose=number(meta.previousClose)??(range==='1D'?number(meta.chartPreviousClose):null);
 const percent=number(meta.regularMarketChangePercent);
 const change=previousClose!==null?price-previousClose:percent!==null&&percent!==-100?price-price/(1+percent/100):null;
 const points:MarketPoint[]=[],quote=result.indicators?.quote?.[0],regular=meta.currentTradingPeriod?.regular;
 for(let i=0;i<(result.timestamp?.length??0);i++){
  const time=number(result.timestamp[i]),close=number(quote?.close?.[i]);
  if(time===null||close===null||range==='1D'&&regular&&time<regular.start)continue;
  points.push({time,price:close,volume:Math.max(0,number(quote?.volume?.[i])??0),extended:range==='1D'&&!!regular&&time>=regular.end});
 }
 const last=points.at(-1);
 return {symbol:asset.symbol,name:asset.name,currency:typeof meta.currency==='string'?meta.currency:'',exchange:asset.exchange,price,previousClose,change,changePercent:previousClose?change!/previousClose*100:percent,asOf,points,range,...(last?.extended?{extended:{price:last.price,time:last.time}}:{})};
}

// http
const cache=new Map<string,{expires:number;quote:MarketQuote}>();
async function handleMarketData(request:Request):Promise<Response>{
 const origin=request.headers.get('origin')??'';
 const allowed=origin==='https://toumeron.github.io'||/^http:\/\/(localhost|127\.0\.0\.1):(8080|4173)$/.test(origin);
 const headers={'Content-Type':'application/json','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',...(allowed?{'Access-Control-Allow-Origin':origin}:{}),Vary:'Origin'};
 if(origin&&!allowed)return Response.json({error:'Forbidden'},{status:403,headers});
 if(request.method==='OPTIONS')return new Response('ok',{headers});
 if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers});
 const url=new URL(request.url),symbol=url.searchParams.get('symbol'),range=url.searchParams.get('range')??'1D';
 const asset=MARKET_ASSETS.find(asset=>asset.symbol===symbol);
 if(!asset||!Object.hasOwn(MARKET_RANGES,range))return Response.json({error:'Invalid instrument or range'},{status:400,headers});
 const key=`${symbol}:${range}`,cached=cache.get(key);
 if(cached&&cached.expires>Date.now())return Response.json(cached.quote,{headers:{...headers,'Cache-Control':'public, max-age=60'}});
 const period=MARKET_RANGES[range as MarketRange];
 const upstream=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}`);
 upstream.search=new URLSearchParams({...period,includePrePost:'true'}).toString();
 try{
  const response=await fetch(upstream,{signal:AbortSignal.timeout(7000),headers:{Accept:'application/json','User-Agent':'LimeNote/1.0'}});
  if(!response.ok)throw new Error(`Market HTTP ${response.status}`);
  const quote=parseMarketChart(await response.json(),asset,range as MarketRange);
  if(cache.size>=200)cache.delete(cache.keys().next().value!);
  cache.set(key,{expires:Date.now()+60000,quote});
  return Response.json(quote,{headers:{...headers,'Cache-Control':'public, max-age=60'}});
 }catch(error){console.warn('Market data read failed',error instanceof Error?error.message:'Unknown');return Response.json({error:'Market data unavailable',reason:error instanceof Error&&/^Market HTTP \d{3}$/.test(error.message)?error.message:undefined},{status:502,headers:{...headers,'Cache-Control':'no-store'}});}
}

export { handleMarketData };
export { matchMarketAsset };
export { suggestMarketAssets };
export { parseMarketChart };
export { MARKET_RANGES };
export type { MarketRange };
export type { MarketAsset };
export { MARKET_ASSETS };
export type { MarketPoint };
export type { MarketQuote };
