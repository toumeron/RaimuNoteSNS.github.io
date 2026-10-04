import {page} from './http.ts';
import {metadata,publicUrl,type LinkPreview} from './metadata.ts';
export async function loadPreview(raw:string):Promise<LinkPreview|null> {
  const original=publicUrl(raw).href;let url=publicUrl(original);
  for(let redirects=0;redirects<=3;redirects++){
    const result=await page(url);
    if(result.status>=300&&result.status<400&&result.location){url=publicUrl(new URL(result.location,url).href);continue;}
    return metadata(result.html,url.href,original);
  }
  return null;
}
