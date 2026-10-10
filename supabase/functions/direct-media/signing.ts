export async function cloudinarySignature(params:Record<string,string>,secret:string):Promise<string>{
 const value=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&')+secret;
 const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function cloudinaryDownloadUrl(cloud:string,key:string,secret:string,publicId:string,format:string,now=Math.floor(Date.now()/1000)):Promise<string>{
 const params={public_id:publicId,format,type:'authenticated',timestamp:String(now),expires_at:String(now+3600),attachment:'false'};
 const query=new URLSearchParams({...params,signature:await cloudinarySignature(params,secret),api_key:key});return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/download?${query}`;
}
