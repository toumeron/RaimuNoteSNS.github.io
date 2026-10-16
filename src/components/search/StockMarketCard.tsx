import {useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowDown,ArrowUp} from 'lucide-react';
import {getMarketQuote,formatMarketPrice,MARKET_RANGES,type MarketAsset,type MarketRange,type MarketQuote} from '@/lib/marketData';
import './stock-market.css';
function useQuote(asset:MarketAsset,range:MarketRange='1D'){
 return useQuery({queryKey:['market-quote',asset.symbol,range],queryFn:({signal})=>getMarketQuote(asset.symbol,range,signal),staleTime:60000,gcTime:15*60000,retry:false,refetchOnWindowFocus:false});
}
export function StockSuggestion({asset}:{asset:MarketAsset}){
 const {data}=useQuote(asset);
 return <><span className="lime-stock-suggestion-name"><strong>{asset.name}</strong><span>{asset.symbol} · {asset.exchange}</span></span><span className="lime-stock-suggestion-price">{data?<><strong>{formatMarketPrice(data.price,data.currency)}</strong><span className={data.change!==null&&data.change<0?'lime-stock-down':'lime-stock-up'}>{data.changePercent!==null?`${data.changePercent>=0?'+':''}${data.changePercent.toFixed(2)}%`:'—'}</span></>:<span aria-label="株価を読み込み中">—</span>}</span></>;
}
function StockChart({quote,onSelect}:{quote:MarketQuote;onSelect:(index:number|null)=>void}){
 const gradient=useId().replace(/:/g,''),[selected,setSelected]=useState<number|null>(null);
 const points=quote.points;
 if(!points.length)return <div className="lime-stock-chart-empty">チャートデータはありません</div>;
 const width=720,height=240,volumeTop=216,plotBottom=198;
 const values=points.map(point=>point.price),low=Math.min(...values,quote.previousClose??Infinity),high=Math.max(...values,quote.previousClose??-Infinity),span=high-low||Math.max(high*.01,1);
 const x=(index:number)=>points.length===1?width/2:index/(points.length-1)*width;
 const y=(price:number)=>12+(high-price)/span*(plotBottom-24);
 const line=(rows:typeof points,offset=0)=>rows.map((point,index)=>`${index?'L':'M'}${x(index+offset).toFixed(2)},${y(point.price).toFixed(2)}`).join(' ');
 const firstExtended=points.findIndex(point=>point.extended),regular=firstExtended<0?points:points.slice(0,firstExtended),extended=firstExtended<0?[]:points.slice(Math.max(0,firstExtended-1));
 const regularPath=line(regular),volume=Math.max(...points.map(point=>point.volume),1),color=(quote.change??0)<0?'#f43f5e':'#00ba8a';
 const select=(index:number|null)=>{setSelected(index);onSelect(index);};
 return <svg className="lime-stock-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${quote.name} ${quote.range} 株価チャート。安値 ${formatMarketPrice(Math.min(...values),quote.currency)}、高値 ${formatMarketPrice(Math.max(...values),quote.currency)}`} onPointerMove={event=>{const bounds=event.currentTarget.getBoundingClientRect();select(Math.max(0,Math.min(points.length-1,Math.round((event.clientX-bounds.left)/bounds.width*(points.length-1)))));}} onPointerLeave={()=>select(null)} onPointerUp={event=>{if(event.pointerType==='touch')select(null);}}>
  <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".32"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
  {quote.previousClose!==null&&<line x1="0" x2={width} y1={y(quote.previousClose)} y2={y(quote.previousClose)} className="lime-stock-reference"/>}
  {regular.length>0&&<><path d={`${regularPath} L${x(regular.length-1)},${plotBottom} L${x(0)},${plotBottom} Z`} fill={`url(#${gradient})`}/><path d={regularPath} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/></>}
  {extended.length>0&&<path d={line(extended,Math.max(0,firstExtended-1))} fill="none" stroke="currentColor" opacity=".45" strokeWidth="2.4" strokeLinejoin="round"/>}
  {points.map((point,index)=><rect key={`${point.time}-${index}`} x={x(index)} y={height-point.volume/volume*(height-volumeTop)} width={Math.max(.8,width/points.length*.65)} height={point.volume/volume*(height-volumeTop)} fill="currentColor" opacity=".18"/>)}
  {selected!==null&&points[selected]&&<><line x1={x(selected)} x2={x(selected)} y1="0" y2={height} className="lime-stock-reference"/><circle cx={x(selected)} cy={y(points[selected].price)} r="4" fill={points[selected].extended?'currentColor':color}/></>}
 </svg>;
}
export function StockMarketCard({asset}:{asset:MarketAsset}){
 const [range,setRange]=useState<MarketRange>('1D'),[selected,setSelected]=useState<number|null>(null);
 const {data,isPending,isError,refetch}=useQuote(asset,range),point=selected!==null?data?.points[selected]:undefined;
 const change=point&&data?.previousClose!==null?point.price-data!.previousClose!:data?.change,percent=point&&data?.previousClose?change!/data.previousClose*100:data?.changePercent;
 const price=point?.price??data?.price;
 return <section className="lime-stock-card" aria-label={`${asset.name}の株価`} data-lime-stock-card>
  <div className="lime-stock-heading"><div><h2>{asset.name}</h2><p>{asset.symbol} · {asset.exchange}{data?.currency?` · ${data.currency}`:''}</p></div></div>
  <div className="lime-stock-price" aria-live="polite">{price!==undefined&&data?formatMarketPrice(price,data.currency):'—'}</div>
  {data&&change!=null&&percent!=null&&<p className={`lime-stock-change ${change<0?'lime-stock-down':'lime-stock-up'}`}>{change<0?<ArrowDown/>:<ArrowUp/>}{formatMarketPrice(Math.abs(change),data.currency)}（{percent>=0?'+':''}{percent.toFixed(2)}%）</p>}
  <div className="lime-stock-secondary">{point?new Date(point.time*1000).toLocaleString('ja-JP'):data?.extended?`時間外 ${formatMarketPrice(data.extended.price,data.currency)}`:'\u00a0'}</div>
  {isPending?<div className="lime-stock-chart-empty" role="status" aria-label="株価を読み込み中"><div className="lime-stock-loading"/></div>:isError?<div className="lime-stock-chart-empty"><span>株価を取得できませんでした</span><button type="button" onClick={()=>void refetch()}>再読み込み</button></div>:data?<StockChart key={range} quote={data} onSelect={setSelected}/>:null}
  <div className="lime-stock-ranges" role="group" aria-label="チャートの期間">{(Object.keys(MARKET_RANGES) as MarketRange[]).map(value=><button type="button" key={value} aria-pressed={range===value} onClick={()=>{setSelected(null);setRange(value);}}>{value}</button>)}</div>
  <p className="lime-stock-attribution">
   <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(asset.symbol)}/`} target="_blank" rel="noopener noreferrer">Yahoo Finance</a>
   <span>{data ? `${new Date(data.asOf*1000).toLocaleString('ja-JP')} 時点 · 遅延する場合があります` : '遅延する場合があります'}</span>
  </p>
 </section>;
}
