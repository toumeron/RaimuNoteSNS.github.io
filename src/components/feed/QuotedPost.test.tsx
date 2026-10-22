vi.mock("@/components/feed/PostCard", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), PostCard:({post,embedded}:any)=><p data-embedded={embedded}>{post.content}</p>}));
vi.mock("@/components/post/CommentList", async importOriginal => ({...await importOriginal<typeof import("@/components/post/CommentList")>(), RepostedReplyCard:({post,embedded}:any)=><p data-embedded={embedded}>{post.content}</p>}));


vi.mock("@/App", async importOriginal => ({
  ...await importOriginal<typeof import("@/App")>(),
  PostOverlay: ({ initialQuotedPost, isOpen, onClose }: { initialQuotedPost: PostWithAuthor; isOpen: boolean; onClose: () => void }) => (
  isOpen ? <button onClick={onClose}>引用投稿する: {initialQuotedPost.content}</button> : null
)
}));
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi, describe } from "vitest";
import { QuotedPost, QuoteModal, ExternalPostDetails } from "@/components/feed/QuotedPost";
import { QUOTE_TEXT_LIMIT } from "@/lib/utils";
import { type PostWithAuthor } from "@/types/index";
import { ProviderVerificationBadge } from "@/components/ui/avatar";

describe("QuotedPost", () => {


afterEach(cleanup);
it.each([undefined,'reply-id'])('bounds the parent text for ordinary and reply quotes without mutating the original: %s',replyId=>{
 const post={id:'x:parent',content:'あ'.repeat(200),replyId} as any;
 render(<QuotedPost post={post}/>);
 expect(screen.getByText('あ'.repeat(QUOTE_TEXT_LIMIT)+'…')).toHaveAttribute('data-embedded','true');
 expect(post.content).toHaveLength(200);
});

it.each([undefined,'reply-id'])('uses the side-by-side layout only for quoted photos with text: %s',replyId=>{
 const post={id:'source',content:'画像の説明',imageUrls:['photo.jpg'],replyId} as any;
 const view=render(<QuotedPost post={post}/>);
 expect(view.container.querySelector('[data-lime-quoted-post]')).toHaveAttribute('data-lime-quote-image-text','true');
 view.rerender(<QuotedPost post={{...post,content:''}}/>);
 expect(view.container.querySelector('[data-lime-quoted-post]')).not.toHaveAttribute('data-lime-quote-image-text');
 view.rerender(<QuotedPost post={{...post,imageUrls:[]}}/>);
 expect(view.container.querySelector('[data-lime-quoted-post]')).not.toHaveAttribute('data-lime-quote-image-text');
});
});

describe("QuoteModal", () => {

describe('quote composer overlay', () => {
  it('passes the original post to the existing post overlay and forwards closing', () => {
    const close = vi.fn();
    const { unmount } = render(<QuoteModal post={{ id: 'original', content: '元の投稿' } as PostWithAuthor} onClose={close} />);
    fireEvent.click(screen.getByText('引用投稿する: 元の投稿'));
    expect(close).toHaveBeenCalledOnce();
    unmount();
  });
});
});

describe("ExternalPostDetails", () => {
afterEach(cleanup);
it('does not render view, repost, quote or bookmark summary text',()=>{const {container}=render(<ExternalPostDetails post={{externalDetails:{views:4811,reposts:0,quotes:0,bookmarks:0}} as PostWithAuthor}/>);expect(container).toBeEmptyDOMElement();});
it('renders poll results and community notes with no native voting request',()=>{render(<ExternalPostDetails post={{blueskyUrl:'https://twitter.com/artist/status/20',externalDetails:{poll:{options:[{label:'A',votes:2},{label:'B',votes:3}],endsAt:'2099-01-01T00:00:00Z'},communityNote:'参考情報'}} as PostWithAuthor}/>);expect(screen.getByText('40%')).toBeInTheDocument();expect(screen.getByRole('link',{name:'twitterで投票する'})).toHaveAttribute('href','https://twitter.com/artist/status/20');expect(screen.getByText('参考情報')).toBeInTheDocument();});
it('displays provider verification independently of the LimeNote official badge',()=>{render(<ProviderVerificationBadge verification={{provider:'twitter',type:'organization'}}/>);expect(screen.getByRole('img',{name:'twitter認証済み'})).toHaveAttribute('src',`${import.meta.env.BASE_URL}verified.png`);});
});
