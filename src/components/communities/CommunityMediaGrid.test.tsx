import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import type {PostWithAuthor} from '@/types';
const f=vi.hoisted(()=>({open:vi.fn()}));
vi.mock('@/components/ui/avatar',()=>({ProfileMediaPreview:({src,postId}:{src?:string;postId?:string})=>src?<img alt="プレビュー" src={src}/>:<span data-testid="video-preview">{postId}</span>}));
vi.mock('@/lib/mediaThumbnail',()=>({openMediaViewer:f.open}));
import {CommunityMediaGrid} from './CommunityMediaGrid';
afterEach(()=>{cleanup();vi.clearAllMocks()});
const post={id:'post',communityId:'community',imageUrls:['https://res.cloudinary.com/demo/first.jpg','https://res.cloudinary.com/demo/second.jpg']} as PostWithAuthor;
it('uses the profile grid with one square per image and opens the original scoped post',()=>{
 const view=render(<CommunityMediaGrid posts={[post,post]}/>);
 expect(view.container.querySelector('[data-lime-profile-media-grid]')).toHaveClass('grid-cols-3','gap-1');
 expect(screen.getAllByRole('button')).toHaveLength(2);expect(screen.getAllByRole('img')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'画像2を開く'}));expect(f.open).toHaveBeenCalledWith({url:post.imageUrls[1],post});
});
it('shows a video preview and opens the shared video viewer with community context',()=>{
 const videoPost={...post,id:'video',imageUrls:[],video:{duration:8,width:1280,height:720}} as PostWithAuthor;
 render(<CommunityMediaGrid posts={[videoPost]}/>);expect(screen.getByTestId('video-preview')).toHaveTextContent('video');
 fireEvent.click(screen.getByRole('button',{name:'動画を開く'}));expect(f.open).toHaveBeenCalledWith(expect.objectContaining({post:videoPost,postId:'video',video:expect.objectContaining({video:videoPost.video})}));
});
