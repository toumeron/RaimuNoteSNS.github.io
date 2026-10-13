import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
vi.mock('@/components/YouTubeEmbed',()=>({YouTubeEmbed:({videoId}:{videoId:string})=><iframe title="YouTube video player" src={`https://www.youtube.com/embed/${videoId}`}/>}));
import {DirectMessageContent,DirectMessageMedia,youtubeMessageId} from './DirectMessageContent';
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
