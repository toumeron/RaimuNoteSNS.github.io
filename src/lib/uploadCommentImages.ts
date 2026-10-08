import {getCurrentUserId} from './currentUser';
import {uploadPostMedia} from './uploadPostMedia';
/** Safe compatibility helper for future callers. Actual replies supply their
 * parent audience through createComment. Default to private attachments. */
export async function uploadCommentImages(urls:string[]):Promise<string[]> {
 if(urls.length>4)throw new Error('画像は4枚まで添付できます');
 if(!urls.length)return [];
 const owner=await getCurrentUserId();if(!owner)throw new Error('ログインしてください');
 return uploadPostMedia(urls,owner,crypto.randomUUID(),true);
}
