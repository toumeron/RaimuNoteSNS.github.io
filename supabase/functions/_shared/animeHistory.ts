/** Shared validation and Annict catalog logic. No credentials or browser state live here. */
export const ANIME_SOURCES = {manual:'手動で追加',post:'ポストから追加',primevideo:'Prime Video',danime:'dアニメストア',niconico:'ニコニコ動画',abema:'ABEMA'} as const;
export type AnimeSource = keyof typeof ANIME_SOURCES;
export type AnimeWork = {id:number;title:string;aliases:string[];image:string;copyright:string;season:string;episodesCount:number;imageFallbacks?:string[];imageCredits?:{name:string;url:string}[]};
export type AnimeEpisode = {id:number;workId:number;number:string;title:string};
export type AnimeHistoryEntry = {id:string;work:AnimeWork;episode:AnimeEpisode|null;episodeText:string;watchedAt:string|null;addedAt:string;source:AnimeSource;sourceUrl:string;postId?:string};
export type AnimeHistoryState = {entries:AnimeHistoryEntry[];ignored:string[];autoAdd:boolean};
export type AnimeImportItem = {title:string;episodeText:string;watchedAt:string|null;source:Exclude<AnimeSource,'manual'|'post'>;sourceUrl:string};
export const EMPTY_ANIME_HISTORY:AnimeHistoryState={entries:[],ignored:[],autoAdd:true};
export const normalizeAnimeTitle=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\p{P}\p{Z}\s]/gu,'');
export function animeHttps(value:unknown):string {
 if(typeof value!=='string'||value.length>2000)return '';
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
/** Only catalog image namespaces are rendered; expired official domains can serve parking ads with HTTP 200. */
export function animeArtworkUrl(value:unknown):string {
 const safe=animeHttps(value);if(!safe)return '';
 const {hostname,pathname}=new URL(safe);
 if(/^s\d*\.anilist\.co$/.test(hostname)&&pathname.startsWith('/file/anilistcdn/media/anime/'))return safe;
 if(hostname==='cdn.myanimelist.net'&&pathname.startsWith('/images/anime/'))return safe;
 return '';
}
export function animeService(url:string):AnimeImportItem['source']|null {
 let u:URL;try{u=new URL(url);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password)return null;
 const host=u.hostname;
 if(['www.primevideo.com','primevideo.com','www.amazon.co.jp','amazon.co.jp'].includes(host))return 'primevideo';
 if(['animestore.docomo.ne.jp','anime.dmkt-sp.jp'].includes(host))return 'danime';
 if(['www.nicovideo.jp','nicovideo.jp','ch.nicovideo.jp'].includes(host))return 'niconico';
 if(host==='abema.tv')return 'abema';
 return null;
}
export function parseAnimeImport(value:unknown):AnimeImportItem[] {
 const data=value as {format?:unknown;version?:unknown;items?:unknown};
 if(data?.format!=='limenote-anime-history'||data.version!==1||!Array.isArray(data.items)||data.items.length>1000)throw new Error('LimeNote視聴履歴のJSONを選択してください（最大1,000件）');
 const rows:AnimeImportItem[]=[];
 for(const item of data.items){
  if(!item||typeof item!=='object')throw new Error('取り込みデータの形式が正しくありません');
  const row=item as Record<string,unknown>;
  if(typeof row.title!=='string'||!row.title.trim()||row.title.length>300||typeof row.sourceUrl!=='string'||animeService(row.sourceUrl)!==row.source)throw new Error('作品名または配信サービスのURLが正しくありません');
  const watchedAt=row.watchedAt==null?null:typeof row.watchedAt==='string'&&Number.isFinite(Date.parse(row.watchedAt))?new Date(row.watchedAt).toISOString():undefined;
  if(watchedAt===undefined||watchedAt&&Date.parse(watchedAt)>Date.now()+86400000)throw new Error('視聴日時が正しくありません');
  if(row.episodeText!=null&&(typeof row.episodeText!=='string'||row.episodeText.length>300))throw new Error('話数の形式が正しくありません');
  // Query strings can contain session or tracking data. They are never imported.
  const url=new URL(row.sourceUrl),params=new URLSearchParams();if(row.source==='danime')for(const key of ['workId','partId']){const v=url.searchParams.get(key);if(v&&/^\d{1,16}$/.test(v))params.set(key,v);}url.search=params.toString();url.hash='';
  rows.push({title:row.title.trim(),episodeText:String(row.episodeText??'').trim(),watchedAt,source:row.source as AnimeImportItem['source'],sourceUrl:url.href});
 }
 return [...new Map(rows.map(row=>[[row.source,row.sourceUrl,row.title,row.episodeText].join('|'),row])).values()];
}
export function animeEntry(work:AnimeWork,episode:AnimeEpisode|null,options:{source:AnimeSource;watchedAt?:string|null;episodeText?:string;sourceUrl?:string;postId?:string}):AnimeHistoryEntry {
 const episodeText=episode?[episode.number,episode.title].filter(Boolean).join(' '):(options.episodeText??'').slice(0,300);
 const key=episode?`episode:${episode.id}`:episodeText?`label:${normalizeAnimeTitle(episodeText).slice(0,120)}`:'work';
 return {id:`annict:${work.id}:${key}`,work,episode,episodeText,watchedAt:options.watchedAt??null,addedAt:new Date().toISOString(),source:options.source,sourceUrl:animeHttps(options.sourceUrl),...(options.postId?{postId:options.postId}:{})};
}
function workFromApi(value:any):AnimeWork|null {
 if(!Number.isSafeInteger(value?.id)||value.id<=0||typeof value.title!=='string'||!value.title.trim())return null;
 return {id:value.id,title:value.title.slice(0,300),aliases:[value.title,value.title_kana,value.title_en,value.title_short1,value.title_short2,value.twitter_hashtag?`#${value.twitter_hashtag}`:null].filter((v):v is string=>typeof v==='string'&&v.length>1).slice(0,8),image:animeArtworkUrl(value.images?.facebook?.og_image_url)||animeArtworkUrl(value.images?.recommended_url),copyright:String(value.images?.copyright??'').slice(0,300),season:String(value.season_name_text??'').slice(0,80),episodesCount:Number(value.episodes_count)||0};
}
export function animeTitleQueries(content:string):string[] {
 const result:string[]=[];
 for(const match of content.matchAll(/[「『【]([^」』】\n]{2,80})[」』】]|[#＃]([^\s#＃。、!?！？]{2,70})/gu))result.push(match[1]??match[2]);
 for(const clause of content.replace(/https?:\/\/\S+/g,'').split(/[\n。、!?！？]/u)){
  const title=clause.trim().replace(/(?:[ 　]*(?:第?\s*[0-9０-９]+\s*[話回]|#[0-9]+).*|(?:を?(?:見た|観た|視聴した|見てる|観てる)|最高|面白かった|おもしろかった).*)$/u,'').trim();
  if(title.length>=3&&title.length<=80)result.push(title);
 }
 return [...new Set(result.map(s=>s.replace(/^アニメ[「『]?/,'').trim()).filter(s=>s.length>=2))].slice(0,4);
}
export function mentionedAnime(content:string,works:AnimeWork[]):AnimeWork[] {
 const text=content.normalize('NFKC').toLocaleLowerCase('ja');
 const hits:{work:AnimeWork;start:number;end:number}[]=[];
 for(const work of works){
  for(const raw of work.aliases){
   const name=raw.normalize('NFKC').toLocaleLowerCase('ja');let start=text.indexOf(name);
   while(start>=0){
    const before=text.slice(Math.max(0,start-1),start),after=text.slice(start+name.length,start+name.length+16);
    const ascii=/^[a-z0-9 ]+$/i.test(name);const boundary=!ascii||(!/[a-z0-9]/i.test(before)&&!/[a-z0-9]/i.test(after[0]??''));
    const specific=name.length>=4||name.startsWith('#')||/[「『【#]/u.test(before)||/^(?:[」』】]|\s*(?:第?\d+話|を?(?:見|観|視聴)))/u.test(after);
    if(boundary&&specific)hits.push({work,start,end:start+name.length});
    start=text.indexOf(name,start+name.length);
   }
  }
 }
 const selected:typeof hits=[];
 for(const hit of hits.sort((a,b)=>(b.end-b.start)-(a.end-a.start)))if(!selected.some(other=>hit.start<other.end&&hit.end>other.start))selected.push(hit);
 // Identical titles belonging to different seasons/remakes are ambiguous.
 return [...new Map(selected.filter(hit=>!hits.some(other=>other.work.id!==hit.work.id&&other.start===hit.start&&other.end===hit.end)).map(hit=>[hit.work.id,hit.work])).values()].slice(0,5);
}
export function importWorkTitle(row:Pick<AnimeImportItem,'title'>):string {
 // Annict's substring search distinguishes 「！」 from "!". Preserve the source spelling.
 return row.title.normalize('NFC').replace(/^\s*(?:TV\s*アニメ|テレビアニメ|アニメ版|\[アニメ\])\s*/iu,'')
  .replace(/\s*(?:第\s*[0-9０-９]+\s*[話回]|[#＃]\s*[0-9０-９]+|Episode\s*[0-9０-９]+|エピソード\s*[0-9０-９]+).*$/iu,'')
  .replace(/\s*[（(【](?:字幕版|吹替版|日本語字幕版|日本語吹替版|見放題|無料配信|HD|最速先行配信)[）)】]\s*$/iu,'').trim();
}
function importTitleSignature(title:string):string {
 return importWorkTitle({title}).normalize('NFKC').toLowerCase()
  .replace(/(?:第\s*)?(\d+)\s*期|(?:シーズン|season)\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*season/giu,(_,a,b,c)=>Number(a??b??c)===1?'':`第${Number(a??b??c)}期`)
  .replace(/\s+/g,'').trim();
}
export function matchImportedAnimeWork(title:string,works:AnimeWork[]):AnimeWork|null {
 const wanted=importTitleSignature(title);if(!wanted)return null;
 const folded=normalizeAnimeTitle(wanted);
 const ranked=[...new Map(works.map(work=>[work.id,work])).values()].map(work=>{
  const aliases=[work.title,...work.aliases.filter(alias=>!alias.startsWith('#'))].map(importTitleSignature);
  const score=aliases.includes(wanted)?100:aliases.some(alias=>normalizeAnimeTitle(alias)===folded)?90:0;
  return {work,score};
 }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
 return ranked.length&&ranked[0].score>(ranked[1]?.score??0)?ranked[0].work:null;
}
export function animeImportSearchQueries(item:Pick<AnimeImportItem,'title'>):string[] {
 const title=importWorkTitle(item),season=title.replace(/\s*(?:(?:第\s*)?[0-9０-９]+\s*期|(?:シーズン|season)\s*[0-9０-９]+|[0-9０-９]+(?:st|nd|rd|th)\s*season)\s*$/iu,'').trim();
 const fragments=title.split(/[\p{P}\p{S}]/u).map(s=>s.trim()).filter(s=>s.length>=3).sort((a,b)=>b.length-a.length);
 return [...new Set([title,title.replace(/[!！?？。．.]+$/u,'').trim(),season,...fragments])].filter(s=>s.length>=2).slice(0,4);
}
export function exactAnimeWork(title:string,works:AnimeWork[]):AnimeWork|null {
 const wanted=normalizeAnimeTitle(title);const exact=works.filter(work=>work.aliases.filter(s=>!s.startsWith('#')).some(alias=>normalizeAnimeTitle(alias)===wanted));
 return exact.length===1?exact[0]:null;
}
export function animeEpisodeNumber(text:string):string|null {
 return text.normalize('NFKC').match(/第\s*(\d+(?:\.\d+)?)\s*[話回]|#\s*(\d+(?:\.\d+)?)|(?:episode|エピソード)\s*(\d+(?:\.\d+)?)|(?:^|\s)(\d+(?:\.\d+)?)\s*話/iu)?.slice(1).find(Boolean)??null;
}
/** Fixed read-only endpoints. Public catalog cache is bounded, refreshed on demand only. */
export class AnnictCatalog {
 private cache=new Map<string,{until:number;value:any}>();
 constructor(private token:string,private transport:typeof fetch=fetch){}
 private async read(path:'works'|'episodes',params:Record<string,string|number>){
  const url=new URL(`https://api.annict.com/v1/${path}`);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const key=url.href,cached=this.cache.get(key);if(cached&&cached.until>Date.now())return cached.value;
  if(!this.token)throw new Error('Annictとの接続がまだ設定されていません');
  const response=await this.transport(url,{headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json','User-Agent':'LimeNote/1.0'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?'Annictの利用制限中です。時間をおいて再試行してください':'Annictから作品情報を取得できませんでした');}
  const data=await response.json();if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{until:Date.now()+30*60*1000,value:data});return data;
 }
 async search(query:string):Promise<AnimeWork[]>{const data=await this.read('works',{filter_title:query.slice(0,100),per_page:30,sort_watchers_count:'desc'});return (Array.isArray(data.works)?data.works:[]).map(workFromApi).filter(Boolean);}
 async resolveImport(item:AnimeImportItem):Promise<{work:AnimeWork|null;episode:AnimeEpisode|null;candidates:AnimeWork[];ambiguous:boolean}>{
  const title=importWorkTitle(item),works=new Map<number,AnimeWork>();
  let match:AnimeWork|null=null;
  for(const query of animeImportSearchQueries(item)){
   for(const work of await this.search(query))works.set(work.id,work);
   match=matchImportedAnimeWork(title,[...works.values()]);if(match)break;
  }
  if(!match&&title.length>=2){
   for(const work of await this.suggest(title))works.set(work.id,work);
   match=matchImportedAnimeWork(title,[...works.values()]);
  }
  const episode=match?await this.episodeForText(match.id,item.episodeText||item.title):null;
  return {work:match,episode,candidates:[...works.values()].slice(0,10),ambiguous:!match};
 }
 /** Expand public suggestions without changing strict matching used by imports/posts. */
 async suggest(query:string):Promise<AnimeWork[]>{
  query=query.trim().slice(0,100);
  const cacheKey=`suggest:${normalizeAnimeTitle(query)}`,cached=this.cache.get(cacheKey);
  if(cached&&cached.until>Date.now())return cached.value;
  const [direct,hints]=await Promise.all([this.search(query),this.searchAliases(query)]);
  const titles=[...new Set(hints.map(h=>h.title))].filter(title=>normalizeAnimeTitle(title)!==normalizeAnimeTitle(query)).slice(0,4);
  const expanded=await Promise.all(titles.map(title=>this.search(title).catch(()=>[])));
  const works=new Map(direct.map(work=>[work.id,work]));
  for(const work of expanded.flat()){
   const matching=hints.filter(h=>normalizeAnimeTitle(h.title)===normalizeAnimeTitle(work.title)&&(!h.year||!work.season.match(/(\d{4})年/)||Number(work.season.match(/(\d{4})年/)?.[1])===h.year));
   if(!matching.length)continue;
   const previous=works.get(work.id)??work;
   works.set(work.id,{...previous,aliases:[...new Set([...previous.aliases,...matching.flatMap(h=>h.aliases)])].slice(0,24)});
  }
  const result=[...works.values()].slice(0,30);
  if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);
  this.cache.set(cacheKey,{until:Date.now()+(result.length?30*60000:60000),value:result});return result;
 }
 private async searchAliases(query:string):Promise<{title:string;aliases:string[];year:number|null}[]>{
  const headers={Accept:'application/json','User-Agent':'LimeNote/1.0'};
  const wikidata=new URL('https://www.wikidata.org/w/api.php');
  for(const [key,value] of Object.entries({action:'wbsearchentities',search:query,language:'ja',uselang:'ja',format:'json',limit:'5',type:'item'}))wikidata.searchParams.set(key,value);
  const requests=[
   async()=>{
    const response=await this.transport(wikidata,{headers,redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!response.ok){await response.body?.cancel();return [];}
    const data=await response.json();
    return (Array.isArray(data.search)?data.search:[]).flatMap((row:any)=>{
     if(typeof row.label!=='string'||row.label.length>100)return [];
     const aliases=[row.label,...(Array.isArray(row.aliases)?row.aliases:[]),row.match?.text].filter((name):name is string=>typeof name==='string'&&name.length>=2&&name.length<=100);
     return [{title:row.label,aliases,year:null}];
    });
   },
   async()=>{
    const response=await this.transport('https://graphql.anilist.co',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({query:'query($search:String!){Page(page:1,perPage:5){media(search:$search,type:ANIME){title{native romaji english} synonyms seasonYear}}}',variables:{search:query}}),redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!response.ok){await response.body?.cancel();return [];}
    const data=await response.json();
    return (Array.isArray(data.data?.Page?.media)?data.data.Page.media:[]).flatMap((row:any)=>{
     if(typeof row.title?.native!=='string'||row.title.native.length>100)return [];
     const aliases=[row.title.native,row.title.romaji,row.title.english,...(Array.isArray(row.synonyms)?row.synonyms:[])].filter((name):name is string=>typeof name==='string'&&name.length>=2&&name.length<=100);
     return [{title:row.title.native,aliases,year:Number.isInteger(row.seasonYear)?row.seasonYear:null}];
    });
   },
  ];
  const results=await Promise.all(requests.map(async read=>{try{return await read();}catch{return [];}}));
  return results.flat();
 }
 async work(id:number):Promise<AnimeWork>{const data=await this.read('works',{filter_ids:id,per_page:1});const work=workFromApi(data.works?.[0]);if(!work||work.id!==id)throw new Error('Annictに作品が見つかりません');return work;}
 async episodes(workId:number,page=1):Promise<{episodes:AnimeEpisode[];nextPage:number|null}>{
  const data=await this.read('episodes',{filter_work_id:workId,per_page:50,page,sort_sort_number:'asc'});
  return {episodes:(Array.isArray(data.episodes)?data.episodes:[]).filter((e:any)=>Number.isSafeInteger(e.id)&&e.work?.id===workId).map((e:any)=>({id:e.id,workId,number:String(e.number_text??e.number??''),title:String(e.title??'').slice(0,300)})),nextPage:Number.isInteger(data.next_page)&&data.next_page>page?data.next_page:null};
 }
 async episode(workId:number,id:number):Promise<AnimeEpisode>{
  const data=await this.read('episodes',{filter_ids:id,per_page:1});const e=data.episodes?.[0];if(e?.id!==id||e?.work?.id!==workId)throw new Error('作品とエピソードが一致しません');return {id:e.id,workId,number:String(e.number_text??e.number??''),title:String(e.title??'').slice(0,300)};
 }
 async episodeForText(workId:number,text:string):Promise<AnimeEpisode|null>{
  const number=animeEpisodeNumber(text);if(!number)return null;
  // Up to 200 episodes per resolution; never guess an unseen page or episode.
  let page:number|null=1;for(let i=0;i<4&&page;i++){const result=await this.episodes(workId,page);const found=result.episodes.find(e=>animeEpisodeNumber(e.number)===number||e.number===number);if(found)return found;page=result.nextPage;}return null;
 }
 async mentionWorks(content:string,known:AnimeWork[]=[]):Promise<AnimeWork[]>{
  const works=new Map(known.map(work=>[work.id,work]));
  const linked=[...content.matchAll(/https:\/\/annict\.com\/works\/(\d+)(?!\d)/g)].slice(0,3);
  for(const link of linked){const work=await this.work(Number(link[1]));works.set(work.id,work);}
  // Two seasons cover currently discussed titles without sending a private post to Annict.
  const now=new Date(),quarter=Math.floor(now.getUTCMonth()/3);const seasons=['winter','spring','summer','autumn'];
  for(const offset of [0,-1]){const q=quarter+offset,year=now.getUTCFullYear()+(q<0?-1:0);const data=await this.read('works',{filter_season:`${year}-${seasons[(q+4)%4]}`,per_page:50,sort_watchers_count:'desc'});for(const row of data.works??[]){const work=workFromApi(row);if(work)works.set(work.id,work);}}
  for(const title of animeTitleQueries(content))for(const work of await this.search(title))works.set(work.id,work);
  const found=mentionedAnime(content,[...works.values()]);for(const link of linked){const work=works.get(Number(link[1]));if(work&&!found.some(w=>w.id===work.id))found.push(work);}return found.slice(0,5);
 }
}

type CatalogMedia={title?:{native?:string;romaji?:string;english?:string};synonyms?:string[];seasonYear?:number;bannerImage?:string;coverImage?:{extraLarge?:string;large?:string};siteUrl?:string;trailer?:{id?:string;site?:string}};
const mediaCache=new Map<string,{until:number;pending:Promise<CatalogMedia|null>}>();
let mediaQueue:Promise<unknown>=Promise.resolve(),nextMediaRead=0,mediaUnavailableUntil=0;
/** Artwork and YouTube links share one bounded, on-demand catalog request. */
async function lookupAnimeMedia(work:AnimeWork,transport:typeof fetch):Promise<CatalogMedia|null>{
 const cachedTransport=transport===fetch,key=JSON.stringify([work.id,work.title,work.season]);
 const cached=cachedTransport?mediaCache.get(key):null;if(cached&&cached.until>Date.now())return cached.pending;
 const read=async():Promise<CatalogMedia|null>=>{
  try{
   if(cachedTransport&&mediaUnavailableUntil>Date.now())return null;
   if(cachedTransport){const delay=nextMediaRead-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));nextMediaRead=Date.now()+1000;}
   const query='query($search:String!){Page(page:1,perPage:5){media(search:$search,type:ANIME){title{native romaji english} synonyms seasonYear bannerImage coverImage{extraLarge large} siteUrl trailer{id site}}}}';
   const response=await transport('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,variables:{search:work.title}}),redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!response.ok){if(cachedTransport&&response.status===429)mediaUnavailableUntil=Date.now()+Math.min(60000,Math.max(1000,Number(response.headers.get('retry-after'))*1000||60000));await response.body?.cancel();return null;}
   const data=await response.json(),names=new Set([work.title,...work.aliases.filter(name=>!name.startsWith('#'))].map(normalizeAnimeTitle)),year=Number(work.season.match(/(\d{4})年/)?.[1])||null;
   const matching=(Array.isArray(data.data?.Page?.media)?data.data.Page.media:[]).filter((row:CatalogMedia)=>(!year||!row.seasonYear||year===row.seasonYear)&&[row.title?.native,row.title?.romaji,row.title?.english,...(row.synonyms??[])].some(name=>typeof name==='string'&&names.has(normalizeAnimeTitle(name))));
   return matching.length===1?matching[0]:null;
  }catch{return null;}
 };
 const pending=cachedTransport?mediaQueue.then(read):read();
 if(cachedTransport){
  mediaQueue=pending.then(()=>{},()=>{});if(mediaCache.size>=256)mediaCache.delete(mediaCache.keys().next().value!);
  const value={until:Date.now()+30*60000,pending};mediaCache.set(key,value);void pending.then(media=>{if(!media)value.until=Date.now()+60000;});
 }
 return pending;
}
/** Public artwork lookup; no official-site HTML or images are fetched. */
export async function fetchAnimeArtwork(work:AnimeWork,transport:typeof fetch=fetch):Promise<Pick<AnimeWork,'imageFallbacks'|'imageCredits'>> {
 const names=new Set(work.aliases.filter(name=>!name.startsWith('#')).map(normalizeAnimeTitle));names.add(normalizeAnimeTitle(work.title));
 const year=Number(work.season.match(/(\d{4})年/)?.[1])||null;
 const imageFallbacks:string[]=[],imageCredits:{name:string;url:string}[]=[];
 const media=await lookupAnimeMedia(work,transport);
 if(media){for(const value of [media.bannerImage,media.coverImage?.extraLarge,media.coverImage?.large]){const image=animeArtworkUrl(value);if(image)imageFallbacks.push(image);}if(imageFallbacks.length)imageCredits.push({name:'AniList',url:animeHttps(media.siteUrl)||'https://anilist.co'});}
 if(!imageFallbacks.length)try{
  const url=new URL('https://api.jikan.moe/v4/anime');url.searchParams.set('q',work.title);url.searchParams.set('limit','8');
  const response=await transport(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(response.ok){const data=await response.json();const exact=(data.data??[]).filter((media:any)=>(!year||!media.year||media.year===year)&&[media.title,media.title_japanese,media.title_english,...(media.titles??[]).map((title:any)=>title.title)].some((name:unknown)=>typeof name==='string'&&names.has(normalizeAnimeTitle(name))));
   if(exact.length===1){const media=exact[0];for(const value of [media.images?.webp?.large_image_url,media.images?.jpg?.large_image_url]){const image=animeArtworkUrl(value);if(image)imageFallbacks.push(image);}if(imageFallbacks.length)imageCredits.push({name:'MyAnimeList / Jikan',url:animeHttps(media.url)||'https://myanimelist.net'});}
  }else await response.body?.cancel();
 }catch{/* Keep the original metadata when all public artwork providers are unavailable. */}
 return {imageFallbacks:[...new Set(imageFallbacks)],imageCredits};
}

/** A video ID comes only from an exactly matched catalog record; never fetch official sites. */
export function animeYouTubeUrl(work:AnimeWork,videoId?:string|null):string {
 return videoId&&/^[A-Za-z0-9_-]{11}$/.test(videoId)?`https://www.youtube.com/watch?v=${videoId}`:`https://www.youtube.com/results?search_query=${encodeURIComponent(`${work.title}`)}`;
}
export async function fetchAnimeYouTubeId(work:AnimeWork,transport:typeof fetch=fetch):Promise<string|null> {
 const media=await lookupAnimeMedia(work,transport),trailer=media?.trailer;
 return trailer?.site==='youtube'&&typeof trailer.id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(trailer.id)?trailer.id:null;
}
