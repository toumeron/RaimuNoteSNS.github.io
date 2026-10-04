import {OfflineBookmarkContext} from '@/components/stickers/OfflineBookmarkContext';
import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { spaceRpc } from '@/api/spaces';
import { spaceLinkIn } from '@/lib/spaceLinks';
import { useSpaces, SpaceAudioLevelContext, type LiveSpace } from './SpaceContext';

export function SpacePostCard({ content }: { content: string }) {
  const link = spaceLinkIn(content);
  const offline=useContext(OfflineBookmarkContext);
  const { open, joinedId } = useSpaces();
  const query = useQuery({ queryKey: ['space-card', link?.id], queryFn: () => spaceRpc<LiveSpace & { is_active: boolean } | null>('get_space_card', { p_space_id: link!.id }), enabled: !!link && !offline, refetchInterval: query => query.state.data?.is_active ? 15000 : false });
  const {isError,isPending}=query;
  const data=offline && link ? offline.spaces[link.id] : query.data;
  if (!link) return null;
  if (!data && (offline || (!isPending && !isError))) return <div className="lime-space-post-card is-ended"><h3>スペース</h3><p>終了しました</p></div>;
  if (!data) return <a href={link ? `https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/${link.id}` : '#'} onClick={event => event.stopPropagation()} className="mt-3 block text-primary">{isError ? 'スペースを開く' : 'スペースを読み込み中…'}</a>;
  const joined = joinedId === data.id;
  return <div className={`lime-space-post-card ${!data.is_active ? 'is-ended' : ''}`} onClick={event => event.stopPropagation()}>
    <div className="lime-space-post-host"><Avatar className="h-8 w-8 border border-white/70"><AvatarImage src={data.profiles.avatar_url} /><AvatarFallback>{data.profiles.display_name.slice(0, 1)}</AvatarFallback></Avatar><span className="truncate font-bold">{data.profiles.display_name}</span><span className="lime-space-post-role">ホスト</span></div>
    <h3>{data.title}</h3>
    {!data.is_active ? <p>終了しました</p> : <button disabled={!!offline} className={joined ? 'is-joined' : ''} onClick={() => open(data.id)}><SpaceVoiceIndicator id={data.id} />{joined ? '参加済み' : 'スペースを聞く'}</button>}
  </div>;
}

function SpaceVoiceIndicator({ id }: { id: string }) {
  const audio = useContext(SpaceAudioLevelContext);
  const volume = audio.id === id ? Math.max(0, Math.min(1, audio.level)) : 0;
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true" data-voice-level={volume}>{[6, 12, 18].map((x, index) => { const height = 3 + volume * (index === 1 ? 15 : 10); return <path key={x} d={`M${x} ${12 - height / 2}v${height}`} />; })}</svg>;
}
