import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import AgoraRTC, { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import { supabase } from '../lib/supabase';
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const APP_ID = "72911fd8a3e344cab6964959b6e6c428"; 

export default function SpacePage() {
  const { id: channelName } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [client, setClient] = useState<IAgoraRTCClient | null>(null);
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hostProfile, setHostProfile] = useState<any>(null);
  const [activeSpaces, setActiveSpaces] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: currentSpace } = await supabase
        .from('spaces')
        .select(`host_id, profiles:host_id (*)`)
        .eq('id', channelName)
        .single();

      if (currentSpace?.profiles) {
        setHostProfile(currentSpace.profiles);
      }

      const { data: spaces } = await supabase
        .from('spaces')
        .select(`id, title, host_id, profiles:host_id (display_name, avatar_url)`)
        .eq('is_active', true)
        .limit(10);
      setActiveSpaces(spaces || []);

      const { data: members } = await supabase
        .from('space_participants')
        .select(`profiles:user_id (*)`)
        .eq('space_id', channelName);
      
      if (members) {
        const others = members
          .map((m: any) => m.profiles)
          .filter((p: any) => p && p.id !== currentSpace?.host_id);
        setParticipants(others);
      }
    };

    fetchData();

    const channel = supabase
      .channel(`space:${channelName}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'space_participants',
        filter: `space_id=eq.${channelName}` 
      }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName]);

  const handleJoin = async (role: 'host' | 'audience') => {
    if (!currentUser) return;

    const agoraClient = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    setClient(agoraClient);
    const uid = Math.abs(currentUser.id.split('-').reduce((acc, part) => acc + parseInt(part, 16), 0) % 1000000);

    if (role === 'host') {
      await supabase.from('spaces').upsert({ 
        id: channelName, 
        host_id: currentUser.id, 
        is_active: true,
        title: `${currentUser.displayName || 'ユーザー'}のスペース`
      });
    }

    await supabase.from('space_participants').upsert({ 
      space_id: channelName, 
      user_id: currentUser.id 
    });

    const { data, error } = await supabase.functions.invoke('agora-token', { 
      body: { channelName, uid, role } 
    });

    if (error) return alert("トークンの取得に失敗しました");

    await agoraClient.setClientRole(role === 'host' ? "host" : "audience");
    
    agoraClient.on("user-published", async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType);
      if (mediaType === "audio") user.audioTrack?.play();
    });

    await agoraClient.join(APP_ID, channelName!, data.token, uid);

    if (role === 'host') {
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await agoraClient.publish([audioTrack]);
      setIsHost(true);
    }
    setJoined(true);
  };

  const handleLeave = async () => {
    if (client && currentUser) {
      await client.leave();
      if (isHost) {
        await supabase.from('spaces').update({ is_active: false }).eq('id', channelName);
      }
      await supabase.from('space_participants').delete().match({ 
        space_id: channelName, 
        user_id: currentUser.id 
      });
      setJoined(false);
      setIsHost(false);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <div className="bg-card rounded-3xl p-6 shadow-soft border border-border/50">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-black italic tracking-tighter mb-6">スペース: {channelName}</h1>
        </header>

        <div className="mb-10">
          <p className="text-xs font-bold text-muted-foreground mb-4 px-1 uppercase tracking-widest text-center">参加中のメンバー</p>
          <div className="flex flex-wrap justify-center gap-4">
            <TooltipProvider>
              {/* 主催者 */}
              {hostProfile && (
                <Tooltip>
                  <TooltipTrigger className="relative">
                    <Avatar className="h-16 w-16 border-4 border-primary shadow-lg scale-110">
                      <AvatarImage src={hostProfile.avatar_url} />
                      <AvatarFallback>{hostProfile.display_name?.[0]}</AvatarFallback>
                    </Avatar>
                    <span className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase ring-2 ring-background">
                      主催者
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>主催者: {hostProfile.display_name}</TooltipContent>
                </Tooltip>
              )}

              {/* リスナー・スピーカー */}
              {participants.map((p) => (
                <Tooltip key={p.id}>
                  <TooltipTrigger>
                    <Avatar className="h-14 w-14 border-2 border-background hover:scale-110 transition-transform shadow-md">
                      <AvatarImage src={p.avatar_url} />
                      <AvatarFallback>{p.display_name?.[0]}</AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>{p.display_name}</TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>

            {!joined && (
              <div className="h-14 w-14 rounded-full border-2 border-dashed border-muted flex items-center justify-center text-muted-foreground text-xs font-bold bg-muted/5">
                +?
              </div>
            )}
          </div>
        </div>

        {!joined ? (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => handleJoin('host')} className="h-24 bg-primary text-primary-foreground rounded-2xl font-black text-lg shadow-lg shadow-primary/20 hover:-translate-y-1 transition-all">🎙️ スピーカーで参加</button>
            <button onClick={() => handleJoin('audience')} className="h-24 bg-secondary text-secondary-foreground rounded-2xl font-black text-lg shadow-lg shadow-secondary/20 hover:-translate-y-1 transition-all">🎧 リスナーで参加</button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="py-10 bg-accent/10 rounded-3xl border-2 border-accent/20 border-dashed">
              <div className="text-5xl animate-bounce mb-4">{isHost ? "🎙️" : "🎧"}</div>
              <p className="font-black text-xl tracking-tighter">{isHost ? "ライブ配信中です" : "視聴中です"}</p>
            </div>
            <button onClick={handleLeave} className="w-full bg-destructive/10 text-destructive border-2 border-destructive/20 py-4 rounded-2xl font-black hover:bg-destructive hover:text-white transition-all text-lg">スペースを退室する</button>
          </div>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-black uppercase tracking-widest px-2 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          開催中のライブ
        </h2>
        <div className="grid gap-3">
          {activeSpaces.filter(s => s.id !== channelName).map((space) => (
            <Link key={space.id} to={`/spaces/${space.id}`} className="group flex items-center justify-between p-4 bg-card rounded-2xl border border-border/50 hover:border-primary transition-all">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 group-hover:scale-105 transition-transform">
                  <AvatarImage src={space.profiles?.avatar_url} />
                  <AvatarFallback>?</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-black leading-tight">{space.id}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">{space.profiles?.display_name} が配信中</p>
                </div>
              </div>
              <div className="px-3 py-1 bg-red-500 text-white text-[10px] font-black rounded-lg uppercase">ライブ中</div>
            </Link>
          ))}
          {activeSpaces.filter(s => s.id !== channelName).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-8 border-2 border-dashed rounded-3xl">現在、他のライブはありません</p>
          )}
        </div>
      </section>
    </div>
  );
}