vi.mock("@/components/feed/RepostButton", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/feed/RepostButton")>();
 const overrides = [
  await (async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/feed/RepostButton")>();
 const overrides = [
  await (() => ({ ExternalLikeButton: ({ post }: any) => <button aria-label="いいね" data-target={post.id}>♡ {post.likesCount}</button> }))(),
  await (() => ({ RepostButton: () => null, BookmarkButton: () => null }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
})(importOriginal),
  await (() => ({ Commentlikebutton: () => { throw new Error('External reply must not use native comment likes'); } }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth: () => ({ user: { id: 'viewer' } })}));

vi.mock("@/components/feed/QuotedPost", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/feed/QuotedPost")>();
 const overrides = [
  await (() => ({ useLinkPreview: () => ({ preview: null, text: (value: string) => value }), LinkPreviewCard: () => null }))(),
  await (() => ({ PostImages: ({ urls }: any) => <div>{urls.map((url: string) => <img key={url} src={url} alt="返信の画像" />)}</div> }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: mocks }));






import { ExternalReplyList } from "@/components/post/ExternalReplyList";
const author = { id: 'bsky-user:person', username: 'person.bsky.social', displayName: '返信者', avatarUrl: '', coverUrl: '', bio: '', createdAt: '2026-10-01', isOfficial: false };
const parent: any = { id: 'bsky:at://did:plc:parent/app.bsky.feed.post/root', author: { ...author, username: 'parent.bsky.social' } };
function Path() { return <output aria-label="path">{useLocation().pathname}</output>; }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
for (const id of ['bsky:at://did:plc:person/app.bsky.feed.post/reply', 'misskey:https://misskey.io/notes/reply123']) {
 it(`renders native reply presentation and in-app actions for ${id.split(':')[0]}`, () => {
   vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
   const reply: any = { id, userId: author.id, content: '外部SNSの返信です', imageUrls: ['https://images.example/reply.png'], createdAt: '2026-10-11', likesCount: 4, likedByMe: false, commentsCount: 2, visibility: 'public', author };
   const { container } = render(<MemoryRouter><ExternalReplyList parent={parent} replies={[reply]} isLoading={false} isError={false} mobileFlat /><Path /></MemoryRouter>);
   expect(container.querySelector('[data-lime-comment-card]')).toBeTruthy();
   expect(screen.getByText('外部SNSの返信です')).toBeVisible();
   expect(container.querySelector('[data-lime-detail-conversations]')).toBeTruthy();
   expect(container.querySelector('.border-b.border-border\\/60')).toBeTruthy();
   expect(container.querySelector('img[src="https://images.example/reply.png"]')).toHaveAttribute('src', reply.imageUrls[0]);
   expect(screen.getByRole('button', { name: 'いいね' })).toHaveAttribute('data-target', id);
   fireEvent.click(screen.getByRole('link', { name: 'この返信に返信する' }));
   expect(screen.getByLabelText('path').textContent).toBe(`/post/${encodeURIComponent(id)}`);
   expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.channel).not.toHaveBeenCalled();
 });
}
it('uses the native author conversation expansion instead of separate rounded cards', () => {
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
 const base: any = { userId: author.id, content: '質問', imageUrls: [], createdAt: '2026-10-11', likesCount: 0, likedByMe: false, commentsCount: 0, visibility: 'public', author };
 const root = { ...base, id: 'bsky:question', externalReplyToId: parent.id };
 const answer = { ...base, id: 'bsky:answer', userId: 'owner', content: '回答', externalReplyToId: root.id };
 const continued = { ...answer, id: 'bsky:continued', content: '続きの回答', externalReplyToId: answer.id };
 const { container } = render(<MemoryRouter><ExternalReplyList parent={{ ...parent, userId: 'owner' }} replies={[root, answer, continued]} isLoading={false} isError={false} mobileFlat /></MemoryRouter>);
 expect(screen.getByText('回答')).toBeVisible();
 expect(screen.queryByText('続きの回答')).toBeNull();
 fireEvent.click(screen.getByRole('button', { name: '返信を表示' }));
 expect(screen.getByText('続きの回答')).toBeVisible();
 expect(container.querySelector('[data-lime-conversation-parent="bsky:answer"]')).toBeTruthy();
});
it('reports failed reads separately from an empty reply list', () => {
 render(<MemoryRouter><ExternalReplyList parent={parent} replies={[]} isLoading={false} isError mobileFlat /></MemoryRouter>);
 expect(screen.getByText('返信の読み込みに失敗しました。')).toBeVisible();
 expect(screen.queryByText('まだ返信はありません。')).toBeNull();
});
it('shows replies whose parents are absent from the loaded external page',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const reply:any={id:'x:2110770275558281467',externalReplyToId:'x:missing-parent',userId:author.id,content:'親が未取得でも表示される返信',imageUrls:[],createdAt:'2026-10-16',likesCount:0,commentsCount:0,author};
 const view=render(<MemoryRouter><ExternalReplyList parent={parent} replies={[reply]} isLoading={false} isError={false} mobileFlat/></MemoryRouter>);
 expect(screen.getByText(reply.content)).toBeVisible();expect(view.container.querySelector('[data-lime-conversation-comment]')).toHaveAttribute('data-lime-conversation-parent','');
});
