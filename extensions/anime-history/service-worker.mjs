const allowed=new Set(['https://toumeron.github.io/RaimuNoteSNS.github.io/watch-history','http://localhost:8080/RaimuNoteSNS.github.io/watch-history']);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='read-transfer'){
  let url;try{url=new URL(sender.url);}catch{return;}
  const validOrigin=url.origin==='https://toumeron.github.io'||(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'&&url.port==='8080');
  if(!validOrigin||!/^\/RaimuNoteSNS\.github\.io\/(?:watch-history|u\/[^/]+\/watch-history)\/?$/.test(url.pathname))return;
  chrome.storage.local.get('anime-history-transfer-v1').then(data=>reply({ok:true,items:Array.isArray(data['anime-history-transfer-v1'])?data['anime-history-transfer-v1'].slice(0,1000):[]})).catch(()=>reply({ok:false}));return true;
 }
 if(message?.type!=='transfer')return;
 (async()=>{
  if(!allowed.has(message.url)||!Array.isArray(message.items)||message.items.length>1000)throw new Error('移行先またはデータを確認してください');
  const url=new URL(message.url),origins=[url.origin+'/*'];if(!await chrome.permissions.contains({origins}))throw new Error('移行先へのアクセスを許可してください');
  const tabs=await chrome.tabs.query({url:url.origin+'/*'});let tab=tabs.find(tab=>tab.url?.startsWith(message.url));
  if(!tab)tab=await chrome.tabs.create({url:message.url,active:false});
  if(tab.status!=='complete')await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(updated);reject(new Error('LimeNoteの読み込みに時間がかかっています'));},30000);
   function updated(id,change){if(id===tab.id&&change.status==='complete'){clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(updated);resolve();}}
   chrome.tabs.onUpdated.addListener(updated);
  });
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:items=>{
   let sent=false;const send=event=>{if(event.source!==window||event.origin!==location.origin||event.data?.type!=='LIME_ANIME_READY'||sent)return;sent=true;window.removeEventListener('message',send);window.postMessage({type:'LIME_ANIME_TRANSFER',version:1,items},location.origin);};
   window.addEventListener('message',send);window.postMessage({type:'LIME_ANIME_HELLO'},location.origin);setTimeout(()=>window.removeEventListener('message',send),60000);
  },args:[message.items]});
  await chrome.tabs.update(tab.id,{active:true});reply({ok:true});
 })().catch(error=>reply({ok:false,error:error.message}));return true;
});
