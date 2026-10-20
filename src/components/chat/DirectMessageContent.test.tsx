vi.mock("@/components/feed/PostCard", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/feed/PostCard")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), YouTubeEmbed:({videoId}:{videoId:string})=><iframe title="YouTube video player" src={`https://www.youtube.com/embed/${videoId}`}/>}))(importOriginal)};
});

import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';

import { DirectMessageContent, DirectMessageMedia, youtubeMessageId } from "@/components/chat/FriendProfile";
afterEach(cleanup);
it('keeps the full destination while formatting a compact readable external link',()=>{
 const url='https://abema.tv/video/title/87-2101';render(<DirectMessageContent content={url}/>);expect(screen.getByRole('link')).toHaveAttribute('href',url);expect(screen.getByText('abema.tv')).toBeInTheDocument();expect(screen.getByText('abema.tv/video/title/87-2101')).toBeInTheDocument();
});
it.each(['https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ','https://m.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ'])('embeds a supported YouTube link: %s',url=>{render(<><DirectMessageMedia content={`見てね ${url}`}/><DirectMessageContent content={`見てね ${url}`}/></>);expect(screen.getByTitle('YouTube video player')).toHaveAttribute('src','https://www.youtube.com/embed/dQw4w9WgXcQ');expect(screen.getByText(/見てね/)).toBeInTheDocument();});
it('does not embed spoofed hosts or invalid IDs and deduplicates a repeated video',()=>{
 expect(youtubeMessageId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();expect(youtubeMessageId('https://youtube.com/watch?v=invalid')).toBeNull();render(<DirectMessageMedia content="https://youtu.be/dQw4w9WgXcQ https://youtube.com/watch?v=dQw4w9WgXcQ"/>);expect(screen.getAllByTitle('YouTube video player')).toHaveLength(1);
});

it('shows a standalone YouTube video without a duplicate link card',()=>{
 render(<><DirectMessageMedia content="https://youtu.be/dQw4w9WgXcQ?si=example"/><DirectMessageContent content="https://youtu.be/dQw4w9WgXcQ?si=example"/></>);
 expect(screen.getByTitle('YouTube video player')).toBeInTheDocument();
 expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('opens Twitter, Misskey and Bluesky links within LimeNote from messages',async()=>{
 const {MemoryRouter,useLocation}=await import('react-router-dom');
 const {fireEvent}=await import('@testing-library/react');
 function Location(){const location=useLocation();return <output data-testid="social-route">{location.pathname}</output>;}
 const items=[['https://x.com/artist/status/123456','x:123456'],['https://misskey.io/notes/abc123','misskey:https://misskey.io/notes/abc123'],['https://bsky.app/profile/artist.bsky.social/post/3abc','bsky:at://artist.bsky.social/app.bsky.feed.post/3abc']];
 const {unmount}=render(<MemoryRouter><Location/>{items.map(([url])=><DirectMessageContent key={url} content={url}/>)}</MemoryRouter>);
 for(const [url,id]of items){const link=screen.getByTitle(url);expect(link).toHaveAttribute('href','/post/'+encodeURIComponent(id));expect(link).not.toHaveAttribute('target');fireEvent.click(link);expect(screen.getByTestId('social-route')).toHaveTextContent('/post/'+encodeURIComponent(id));}
 unmount();
});
