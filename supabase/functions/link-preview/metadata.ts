export type LinkPreview = {url:string;domain:string;title:string;image:string;description?:string};
function decode(value:string):string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,entity:string)=>{
    if(entity[0]==='#'){const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[entity.toLowerCase()]??'';
  });
}
export function publicUrl(raw:string):URL {
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('Invalid URL');
  if(!url.hostname.includes('.')||/localhost|\.local$|\.internal$/i.test(url.hostname))throw new Error('Private host');
  return url;
}
export function publicAddress(address:string):boolean {
  if(address.includes(':'))return /^(2|3)[\da-f]{3}:/i.test(address)&&!/^2001:(db8|0):/i.test(address);
  const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b]=parts;
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
}
function attributes(tag:string):Record<string,string>{
 const result:Record<string,string>={};
 for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]);
 return result;
}
export function metadata(html:string,finalUrl:string,originalUrl=finalUrl):LinkPreview|null {
  const values=new Map<string,string>();
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){
    const attrs=attributes(tag);
    const key=(attrs.property??attrs.name??'').toLowerCase();if(attrs.content&&!values.has(key))values.set(key,attrs.content);
  }
  const clean=(value:string)=>decode(value).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  let product:Record<string,unknown>|undefined;
  for(const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)??[]){
    if(!/application\/ld\+json/i.test(tag.slice(0,tag.indexOf('>'))))continue;
    try{const value=JSON.parse(tag.slice(tag.indexOf('>')+1).replace(/<\/script\s*>$/i,''));const candidates=[value,...(Array.isArray(value)?value:[]),...(Array.isArray(value?.['@graph'])?value['@graph']:[])];product=candidates.find(row=>row&&typeof row==='object'&&[row['@type']].flat().includes('Product'));if(product)break;}catch{/* Invalid structured data cannot replace page metadata. */}
  }
  const amazon=/(^|\.)amazon\.co\.jp$/.test(new URL(finalUrl).hostname);
  const productTitle=amazon?html.match(/<(?:span|h1)\b[^>]*\bid\s*=\s*["']productTitle["'][^>]*>([\s\S]*?)<\/(?:span|h1)\s*>/i)?.[1]:undefined;
  const description=clean(values.get('og:description')??values.get('twitter:description')??values.get('description')??(typeof product?.description==='string'?product.description:'')).slice(0,500);
  const title=clean(values.get('og:title')??values.get('twitter:title')??productTitle??(typeof product?.name==='string'?product.name:undefined)??html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]??'').slice(0,300);
  if(!title&&!description)return null;
  const domain=new URL(finalUrl).hostname.replace(/^www\./,'');
  let rawImage=values.get('og:image')??values.get('twitter:image')??values.get('twitter:image:src');
  if(!rawImage&&product?.image){const value=Array.isArray(product.image)?product.image[0]:product.image;rawImage=typeof value==='string'?value:typeof value==='object'&&value&&'url' in value?String(value.url):undefined;}
  if(!rawImage&&amazon){
    for(const tag of html.match(/<img\b[^>]*>/gi)??[]){const attrs=attributes(tag);if(!['landingImage','imgBlkFront','ebooksImgBlkFront'].includes(attrs.id))continue;rawImage=attrs['data-old-hires']||attrs.src;break;}
  }
  if(!rawImage){for(const tag of html.match(/<link\b[^>]*>/gi)??[]){const attrs=attributes(tag);if(attrs.rel?.split(/\s+/).includes('image_src')){rawImage=attrs.href;break;}}}
  let image='';
  if(rawImage){try{image=publicUrl(new URL(rawImage,finalUrl).href).href;}catch{/* Keep genuine text metadata even without a usable image. */}}
  return {url:originalUrl,domain,title:title||domain,image,...(description?{description}:{})};
}
