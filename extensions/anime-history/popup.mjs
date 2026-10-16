const STORAGE='anime-history-transfer-v1';
const collect=document.getElementById('collect'),transfer=document.getElementById('transfer'),status=document.getElementById('status'),count=document.getElementById('count');
let items=[],historyUrl='';
const openHistory=document.getElementById('open-history');
openHistory.addEventListener('click',async()=>{if(historyUrl)await chrome.tabs.update((await chrome.tabs.query({active:true,currentWindow:true}))[0].id,{url:historyUrl});});
function render(){count.textContent=`保存済み ${items.length}件`;transfer.disabled=!items.length;}
async function persist(){await chrome.storage.local.set({[STORAGE]:items});render();}
try{const saved=await chrome.storage.local.get(STORAGE);if(Array.isArray(saved[STORAGE]))items=saved[STORAGE].slice(0,1000);render();}catch{status.textContent='端末の保存領域を開けませんでした';}
collect.addEventListener('click',async()=>{
 collect.disabled=true;status.textContent='表示中の履歴を読み取っています…';
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw new Error('視聴履歴・ウォッチリストを表示したタブを開いてください');
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extractor.js']});
  const read=result?.result;if(read?.historyUrl){historyUrl=read.historyUrl;openHistory.hidden=false;}if(read?.error)throw new Error(read.error);if(result?.error)throw new Error(result.error.message||'ページの読み取りに失敗しました');if(!read||read.format!=='limenote-anime-history'||!Array.isArray(read.items))throw new Error('このページから履歴を取得できませんでした');
  const before=items.length,merged=new Map(items.map(item=>[[item.source,item.sourceUrl,item.title,item.episodeText].join('|'),item]));
  for(const item of read.items)merged.set([item.source,item.sourceUrl,item.title,item.episodeText].join('|'),item);
  if(merged.size>1000)throw new Error('一度に保存できるのは1,000件までです。移行後に端末のデータを整理してください');
  items=[...merged.values()];await persist();status.textContent=read.items.length?`${items.length-before}件追加しました。続きはページを表示して再度読み取ってください。`:'読み取れる履歴がありません。履歴が画面に表示されていることを確認してください。';
 }catch(error){status.textContent=error.message||'読み取りに失敗しました';}finally{collect.disabled=false;}
});
transfer.addEventListener('click',async()=>{
 const url=document.getElementById('target').value,origin=new URL(url).origin;
 try{const granted=await chrome.permissions.request({origins:[origin+'/*']});if(!granted){status.textContent='移行先へのアクセスが許可されませんでした';return;}
 const result=await chrome.runtime.sendMessage({type:'transfer',url,items});if(!result?.ok)throw new Error(result?.error||'移行先を開けませんでした');status.textContent='LimeNoteで照合結果を確認してください。';
 }catch(error){status.textContent=error.message;}
});
document.getElementById('clear').addEventListener('click',async()=>{items=[];await persist();status.textContent='この端末の移行データを消しました。配信サービスやLimeNoteの履歴は保持しています。';});
