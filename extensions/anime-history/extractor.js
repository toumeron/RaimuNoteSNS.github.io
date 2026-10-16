/* Read only the history or watchlist currently rendered by the service. Never read cookies or private APIs. */
function collectAnimeHistoryPage(){
 const host=location.hostname;
 const providers={primevideo:['primevideo.com','www.primevideo.com','amazon.co.jp','www.amazon.co.jp'],abema:['abema.tv'],danime:['animestore.docomo.ne.jp','anime.dmkt-sp.jp'],niconico:['nicovideo.jp','www.nicovideo.jp','ch.nicovideo.jp']};
 const source=Object.keys(providers).find(key=>providers[key].includes(host));
 if(!source||location.protocol!=='https:')throw new Error('Prime Video・ABEMA・dアニメストア・ニコニコ動画の視聴履歴ページで開いてください');
 const guides={primevideo:'https://www.primevideo.com/settings/watch-history',abema:'https://abema.tv/my-list',danime:'https://animestore.docomo.ne.jp/animestore/rireki_pc',niconico:'https://www.nicovideo.jp/my/history/video'};
 const visible=node=>{
  if(node.closest('[hidden],[aria-hidden="true"],[inert]'))return false;
  if(typeof getComputedStyle==='function')for(let parent=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden')return false;}
  return true;
 };
 const historyLabel=text=>/^(?:視聴履歴|再生履歴|watch\s*history|viewing\s*history)(?:\s*[（(]?\d+[）)]?件?)?$/i.test(text.replace(/\s+/g,' ').trim());
 const main=document.querySelector('main,[role="main"]')||document.body;
 const headings=[...main.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible);
 const selected=[...document.querySelectorAll('[aria-selected="true"],[aria-current="page"],[data-state="active"],[class*="--active"],[class*="__active"],[class*="is-active"],[class*="isActive"]')].filter(visible);
 const historyHeading=headings.find(node=>historyLabel(node.textContent));
 const historyTab=selected.find(node=>historyLabel(node.textContent));
 const watchlistLabel=text=>/^(?:マイリスト|ウォッチリスト|あとで見る|後で見る|watch\s*list|my\s*list)$/i.test(text.replace(/\s+/g,' ').trim());
 const watchlistHeading=headings.find(node=>watchlistLabel(node.textContent));
 const watchlistTab=selected.find(node=>watchlistLabel(node.textContent));
 const path=location.pathname+location.search+location.hash;
 const historyPath=/(?:watch[-_]?history|viewing[-_]?history|\/my\/history(?:\/|$)|\/my-?list\/history|\/animestore\/(?:rireki|history)|[?&#](?:tab|type|mode)=(?:history|watchhistory))/i.test(path);
 const explicit=[...main.querySelectorAll('[data-testid="watch-history"],[data-testid="history-list"],[id="watch-history"],[class*="HistoryList"],[class*="HistoryContent"],[class*="WatchHistory"],[class*="mypage-History"]')].find(visible);
 const watchlistPath=/(?:watch[-_]?list|\/my-?list(?:\/|$)|\/my\/mylist|\/animestore\/mp_viw)/i.test(location.pathname);
 if(!historyPath&&!historyHeading&&!historyTab&&!explicit&&!watchlistPath&&!watchlistHeading&&!watchlistTab)return {format:'limenote-anime-history',version:1,items:[],needsHistory:true,historyUrl:guides[source],error:source==='abema'?'マイページで「視聴履歴」または「マイリスト」を選択してください。':'「視聴履歴」または「ウォッチリスト」を開いてください。'};
 const isWatchlist=!historyPath&&!historyTab&&!historyHeading&&(watchlistPath||!!watchlistTab||!!watchlistHeading);
 const panel=(historyTab||watchlistTab)?.getAttribute('aria-controls');
 const root=(panel&&document.getElementById(panel))||explicit||(historyHeading||watchlistHeading)?.closest('section,[role="tabpanel"]')||main;
 const destination=value=>{
  let url;try{url=new URL(value,location.href);}catch{return null;}
  if(url.protocol!=='https:'||!providers[source].includes(url.hostname)||url.username||url.password)return null;
  const valid=source==='primevideo'?/\/(?:detail|dp|gp\/video\/detail|gp\/product)\/[a-z0-9]+/i.test(url.pathname):source==='abema'?/\/video\/(?:episode|title)\/[\w-]+/.test(url.pathname):source==='danime'?/\/animestore\/(?:ci|cd|sc_d|sc)[^/]*(?:\/|$)/.test(url.pathname)&&['workId','partId'].some(key=>/^\d{1,16}$/.test(url.searchParams.get(key)||'')):/\/(?:watch\/(?:sm|so|nm)?\d+|channel\/[^/]+|ch\d+)/.test(url.pathname);
  if(!valid)return null;
  const params=new URLSearchParams();if(source==='danime')for(const key of ['workId','partId']){const value=url.searchParams.get(key);if(value&&/^\d{1,16}$/.test(value))params.set(key,value);}
  url.search=params.toString();url.hash='';return url;
 };
 const candidates=[...root.querySelectorAll('a[href],[data-href],[data-url],[data-asin],[data-title-id],[data-program-id],[data-series-id]')];
 // ABEMA cards can navigate with a click handler rather than an anchor; thumbnail URLs carry the public program ID.
 if(source==='abema')candidates.push(...root.querySelectorAll('img[src*="/programs/"],img[data-src*="/programs/"],source[srcset*="/programs/"],img[src*="/series/"],img[data-src*="/series/"],source[srcset*="/series/"]'));
 const items=[];
 for(const node of candidates.slice(0,5000)){
  if(!visible(node)||node.closest('aside,nav,header,footer,[data-testid*="recommend"],[class*="Recommend"],[class*="recommend"]'))continue;
  const section=node.closest('section');if(section&&/おすすめ|関連作品|recommended/i.test(section.querySelector('h1,h2,h3,[role="heading"]')?.textContent??''))continue;
  let target=node.getAttribute('href')||node.getAttribute('data-href')||node.getAttribute('data-url');
  const asin=node.getAttribute('data-asin')||node.getAttribute('data-title-id');
  if(!target&&source==='primevideo'&&/^[a-z0-9]{8,20}$/i.test(asin||''))target=`https://www.primevideo.com/detail/${asin}`;
  const program=node.getAttribute('data-program-id')||(node.getAttribute('src')||node.getAttribute('data-src')||node.getAttribute('srcset')||'').match(/\/programs\/([\w-]+)/)?.[1];
  if(!target&&source==='abema'&&/^[\w-]+$/.test(program||''))target=`https://abema.tv/video/episode/${program}`;
  const series=node.getAttribute('data-series-id')||(node.getAttribute('src')||node.getAttribute('data-src')||node.getAttribute('srcset')||'').match(/\/series\/([\w-]+)/)?.[1];
  if(!target&&source==='abema'&&/^[\w-]+$/.test(series||''))target=`https://abema.tv/video/title/${series}`;
  const url=destination(target||'');if(!url)continue;
  let card=node.closest('li,article,[data-testid="history-item"],[data-component="history-item"],[class*="HistoryItem"],[class*="HistoryEntry"],[class*="history-item"],[class*="historyItem"],[class*="history-entry"]');
  if(!card){
   card=node;
   for(let i=0;i<5&&card.parentElement&&card!==root;i++){
    if(card.querySelector('img')&&card.textContent.trim())break;
    const parent=card.parentElement;
    const destinations=new Set([...parent.querySelectorAll('a[href]')].map(a=>destination(a.getAttribute('href'))?.href).filter(Boolean));
    if(destinations.size>1)break;card=parent;
   }
  }
  const image=(node.matches('img')?node:node.querySelector('img'))||card.querySelector('img');
  const titleNode=card.querySelector('[data-work-title],[data-testid="work-title"],[data-testid="title"],[data-automation-id="title"],[class*="series-title"],[class*="SeriesTitle"],h2,h3,.title,[class*="Title"],[class*="title"]');
  let title=(card.getAttribute('data-work-title')||titleNode?.textContent||node.getAttribute('title')||node.getAttribute('aria-label')||image?.getAttribute('alt')||node.textContent||'').replace(/\s+/g,' ').trim();
  if(!title||/^(?:再生|見る|視聴する|play|watch|削除|詳細|サムネイル|thumbnail)$/i.test(title))continue;
  title=title.slice(0,300);
  const episodeNode=card.querySelector('[data-episode-title],[data-testid="episode-title"],[class*="EpisodeTitle"],[class*="episode-title"],[class*="episodeTitle"]');
  const episodeText=(episodeNode?.textContent||title.match(/(?:第\s*[\d０-９]+\s*話|#\s*\d+|Episode\s+\d+).*$/i)?.[0]||'').trim().slice(0,300);
  const dated=card.querySelector('[data-watched-at],time.watched-at,time[data-testid="watched-at"]');
  const rawDate=dated?.getAttribute('data-watched-at')||dated?.getAttribute('datetime');
  const watchedAt=!isWatchlist&&rawDate&&Number.isFinite(Date.parse(rawDate))?new Date(rawDate).toISOString():null;
  items.push({title,episodeText,watchedAt,source,sourceUrl:url.href});
 }
 return {format:'limenote-anime-history',version:1,items:[...new Map(items.map(item=>[[item.sourceUrl,item.episodeText].join('|'),item])).values()].slice(0,1000),historyUrl:guides[source]};
}
function installLimeHistoryBridge(){
 const local=['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='8080';
 const hosted=location.origin==='https://toumeron.github.io';
 if(!(local||hosted)||!/^\/RaimuNoteSNS\.github\.io\/(?:watch-history|u\/[^/]+\/watch-history)\/?$/.test(location.pathname))return false;
 if(globalThis.__limeHistoryBridge)return true;globalThis.__limeHistoryBridge=true;
 window.addEventListener('message',async event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.type!=='LIME_ANIME_REQUEST_TRANSFER'||event.data.version!==1)return;
  try{const response=await chrome.runtime.sendMessage({type:'read-transfer'});if(response?.ok)window.postMessage({type:'LIME_ANIME_TRANSFER',version:1,items:response.items},location.origin);}catch{/* Reload after updating the extension. */}
 });return true;
}
(()=>{if(installLimeHistoryBridge())return {bridge:true};try{return collectAnimeHistoryPage();}catch(error){return {error:error.message};}})();
