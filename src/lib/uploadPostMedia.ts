import { supabase } from './supabase';
import { MEDIA_PREFIX, POST_MEDIA_BUCKET } from './privateMediaFetch';
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
      const path = `${ownerId}/${resourceId}/${crypto.randomUUID()}.${ext}`;
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
