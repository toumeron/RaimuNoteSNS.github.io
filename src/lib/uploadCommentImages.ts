// Use the same Cloudinary destination and preset as the post composer.
// Reject failed uploads so an image reply cannot silently become text only.
export async function uploadCommentImages(urls: string[]): Promise<string[]> {
  if (urls.length > 4) throw new Error('画像は4枚まで添付できます');
  return Promise.all(urls.map(async url => {
    if (/^https?:\/\//.test(url)) return url;
    if (!url.startsWith('blob:')) throw new Error('画像の形式が正しくありません');
    const local = await fetch(url);
    if (!local.ok) throw new Error('添付画像を読み込めませんでした');
    const file = await local.blob();
    if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください');
    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
    const result = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body });
    const data = await result.json();
    if (!result.ok || typeof data.secure_url !== 'string' || !data.secure_url.startsWith('https://')) {
      throw new Error('画像のアップロードに失敗しました');
    }
    return data.secure_url;
  }));
}
