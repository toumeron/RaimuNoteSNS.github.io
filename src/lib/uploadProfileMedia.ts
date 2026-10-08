import {supabase} from './supabase';
export async function uploadProfileMedia(file: File,kind:'timeline-background'|'emoji'):Promise<{secure_url:string;public_id:string;format:string}> {
 const body=new FormData();body.set('file',file);body.set('kind',kind);
 const {data,error}=await supabase.functions.invoke('upload-profile-media',{body});
 if(error||!data?.secure_url||!data?.public_id)throw new Error(data?.error||'画像のアップロードに失敗しました');
 return data;
}
