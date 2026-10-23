import {beforeEach,expect,it,vi} from 'vitest';
const upload=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/mediaThumbnail',()=>({uploadProfileMedia:upload}));
vi.mock('@/lib/supabase',()=>({supabase:{}}));
import {isCloudinaryImage,uploadCommunityImage,uploadCommunityImages} from './communities';
beforeEach(()=>{vi.clearAllMocks();});
it('accepts Cloudinary image delivery URLs and rejects deceptive hosts or storage URLs',()=>{
 expect(isCloudinaryImage('https://res.cloudinary.com/demo/image/upload/v1/picture.webp')).toBe(true);
 for(const url of ['https://res.cloudinary.com.attacker.example/demo/image/upload/x','https://example.supabase.co/storage/image.png','http://res.cloudinary.com/demo/image/upload/x','https://res.cloudinary.com/demo/video/upload/x','data:image/png;base64,abc','blob:local'])expect(isCloudinaryImage(url)).toBe(false);
});
it('validates the full batch before uploading and never redirects attachments to Supabase Storage',async()=>{
 await expect(uploadCommunityImages(['blob:local','https://example.supabase.co/storage/image.png'],'owner')).rejects.toThrow('Cloudinary');expect(upload).not.toHaveBeenCalled();
 await expect(uploadCommunityImages(Array(5).fill('blob:local'),'owner')).rejects.toThrow('4枚');expect(upload).not.toHaveBeenCalled();
});
it('uses the authenticated Cloudinary uploader for community covers and validates provider replies',async()=>{
 upload.mockResolvedValue({secure_url:'https://res.cloudinary.com/demo/image/upload/cover.jpg'});const file=new File(['real bytes'],'cover.jpg',{type:'image/jpeg'});
 expect(await uploadCommunityImage(file,'owner','community-cover')).toBe('https://res.cloudinary.com/demo/image/upload/cover.jpg');expect(upload).toHaveBeenCalledWith(file,'community-cover','owner');
 upload.mockResolvedValue({secure_url:'https://example.supabase.co/storage/image.jpg'});await expect(uploadCommunityImage(file,'owner','community-post')).rejects.toThrow('保存先');
});
it('rejects empty, oversized and unsupported files before contacting image storage',async()=>{
 for(const file of [new File([],'empty.jpg',{type:'image/jpeg'}),new File(['svg'],'unsafe.svg',{type:'image/svg+xml'}),new File([new Uint8Array(8*1024*1024+1)],'large.png',{type:'image/png'})])await expect(uploadCommunityImage(file,'owner','community-cover')).rejects.toThrow('8MB');
 expect(upload).not.toHaveBeenCalled();
});
