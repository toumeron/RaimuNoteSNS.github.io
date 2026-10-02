import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadCommentImages } from './uploadCommentImages';
afterEach(() => vi.unstubAllGlobals());
describe('reply image uploads', () => {
  it('keeps already uploaded URLs', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await uploadCommentImages(['https://example.com/image.jpg'])).toEqual(['https://example.com/image.jpg']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uploads image blobs using the existing post preset', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ secure_url: 'https://example.com/upload.png' }) });
    vi.stubGlobal('fetch', fetch);
    expect(await uploadCommentImages(['blob:preview'])).toEqual(['https://example.com/upload.png']);
    expect(fetch.mock.calls[1][0]).toContain('api.cloudinary.com/v1_1/');
    expect(fetch.mock.calls[1][1].body.get('upload_preset')).toBe(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
  });
  it('rejects failed uploads rather than returning missing images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) }));
    await expect(uploadCommentImages(['blob:preview'])).rejects.toThrow('アップロード');
  });
  it('rejects more than four attachments before sending requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(uploadCommentImages(Array(5).fill('blob:preview'))).rejects.toThrow('4枚');
    expect(fetch).not.toHaveBeenCalled();
  });
});
