import { uploadCommentImages } from "@/lib/uploadCommentImages";
import { randomUUID } from "@/lib/randomUUID";
import { supabase } from "@/lib/supabase";
import { MEDIA_PREFIX, POST_MEDIA_BUCKET } from "@/lib/privateMediaFetch";
import { getCurrentUserId } from "@/lib/currentUser";

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
export async function uploadPostMedia(urls: string[], ownerId: string, resourceId: string, restricted: boolean): Promise<string[]> {
  if (urls.length > 4) throw new Error('画像は4枚まで添付できます');
  // Validate the complete batch before sending any bytes outside this device.
  if (restricted && urls.some(url => /^https?:\/\//i.test(url))) throw new Error('限定投稿には端末から選んだ画像を添付してください。公開URLの画像は非公開にできません');
  if (urls.some(url => !url.startsWith('blob:') && !/^https?:\/\//i.test(url))) throw new Error('画像の形式が正しくありません');
  const uploaded: string[] = [];
  try {
    const results: string[] = [];
    for (const url of urls) {
      if (/^https?:\/\//i.test(url)) { results.push(url); continue; }
      const response = await fetch(url);
      if (!response.ok) throw new Error('添付画像を読み込めませんでした');
      const file = await response.blob(), ext = extensions[file.type];
      if (!ext || file.size > 10 * 1024 * 1024) throw new Error('画像はPNG・JPEG・WebP・GIF・AVIF形式、10MB以内にしてください');
      const path = `${ownerId}/${resourceId}/${randomUUID()}.${ext}`;
      const {error} = await supabase.storage.from(POST_MEDIA_BUCKET).upload(path, file, {upsert: false, contentType: file.type, cacheControl: '0'});
      if (error) {
        const detail=error.message?.trim();
        throw new Error(detail ? `画像のアップロードに失敗しました（${detail}）` : '画像のアップロードに失敗しました', {cause:error});
      }
      uploaded.push(path);
      results.push(`${MEDIA_PREFIX}${path}`);
    }
    return results;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(POST_MEDIA_BUCKET).remove(uploaded);
    throw error;
  }
}

export async function uploadProfileMedia(file: File,kind:'timeline-background'|'emoji'):Promise<{secure_url:string;public_id:string;format:string}> {
 const body=new FormData();body.set('file',file);body.set('kind',kind);
 const {data,error}=await supabase.functions.invoke('upload-profile-media',{body});
 if(error||!data?.secure_url||!data?.public_id)throw new Error(data?.error||'画像のアップロードに失敗しました');
 return data;
}
