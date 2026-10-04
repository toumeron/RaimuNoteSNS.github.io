export type LinkPreview = {url:string;domain:string;title:string;image:string};
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
export function metadata(html:string,finalUrl:string,originalUrl=finalUrl):LinkPreview|null {
  const values=new Map<string,string>();
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){
    const attributes:Record<string,string>={};
    for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attributes[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]);
    const key=(attributes.property??attributes.name??'').toLowerCase();if(attributes.content&&!values.has(key))values.set(key,attributes.content);
  }
  const title=(values.get('og:title')??values.get('twitter:title')??'').replace(/\s+/g,' ').trim().slice(0,300);
  const rawImage=values.get('og:image')??values.get('twitter:image')??values.get('twitter:image:src');
  if(!title||!rawImage)return null;
  try{const image=publicUrl(new URL(rawImage,finalUrl).href);return {url:originalUrl,domain:new URL(finalUrl).hostname.replace(/^www\./,''),title,image:image.href};}catch{return null;}
}
