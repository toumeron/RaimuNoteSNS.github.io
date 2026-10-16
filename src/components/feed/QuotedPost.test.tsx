import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./PostCard',()=>({PostCard:({post,embedded}:any)=><p data-embedded={embedded}>{post.content}</p>}));
vi.mock('@/components/post/CommentList',()=>({RepostedReplyCard:({post,embedded}:any)=><p data-embedded={embedded}>{post.content}</p>}));
import {QuotedPost} from './QuotedPost';
import {QUOTE_TEXT_LIMIT} from '@/lib/postPresentation';
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
