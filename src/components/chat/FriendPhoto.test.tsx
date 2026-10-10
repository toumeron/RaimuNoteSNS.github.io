import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {FriendPhoto} from './FriendPhoto';
import {DirectChatMessage} from './DirectChatMessage';
import {appendFriendPhoto} from '../../../supabase/functions/_shared/friendImages';
const viewer=vi.hoisted(()=>vi.fn());
vi.mock('@/components/media/openMediaViewer',()=>({openMediaViewer:viewer}));
vi.mock('@/api/directMessages',()=>({deleteDirectMessage:vi.fn(),toggleDirectReaction:vi.fn()}));
const photo={url:'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Noodles.jpg/960px-Noodles.jpg',sourceUrl:'https://commons.wikimedia.org/wiki/File:Noodles.jpg',title:'Noodles.jpg',artist:'Photographer',license:'CC BY-SA 4.0'};
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('group friend messages display real photo metadata and use the existing viewer',()=>{
 const message={id:'m',sender_id:'owner',friend_id:'friend',friend_name:'料理フレンド',friend_avatar:'',content:appendFriendPhoto('担々麺だよ。',photo),created_at:'2026-10-11T00:00:00Z',mediaUrls:[],attachments:[],reactions:{}};
 render(<DirectChatMessage message={message as never} userId="viewer" content={<p>担々麺だよ。</p>} enabled onChanged={async()=>{}} onReply={()=>{}}/>);
 expect(screen.getByText('担々麺だよ。')).toBeInTheDocument();expect(screen.getByText(/Photographer/)).toBeInTheDocument();expect(screen.queryByText(/friend-photo/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'フレンドの画像を拡大'}));expect(viewer).toHaveBeenCalledWith({url:photo.url,media:[{src:photo.url,type:'image'}]});
});
it('failed images disappear without hiding the reply',()=>{render(<><FriendPhoto photo={photo}/><p>文章の返信</p></>);fireEvent.error(screen.getByRole('img'));expect(screen.queryByRole('img')).not.toBeInTheDocument();expect(screen.getByText('文章の返信')).toBeInTheDocument()});
it('arbitrary model-generated image hosts are not rendered',()=>{render(<FriendPhoto photo={{...photo,url:'https://example.com/invented.jpg'}}/>);expect(screen.queryByRole('img')).not.toBeInTheDocument()});
