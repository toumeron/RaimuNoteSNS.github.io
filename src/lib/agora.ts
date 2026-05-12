import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack, IRemoteAudioTrack } from "agora-rtc-sdk-ng";
import { supabase } from "./supabase"; // あなたのSupabaseクライアント

const APP_ID = "72911fd8a3e344cab6964959b6e6c428"; // ここはフロントに書いてOK

export const useAgora = () => {
  let client: IAgoraRTCClient | null = null;
  let localAudioTrack: IMicrophoneAudioTrack | null = null;

  const join = async (channelName: string, userId: string, role: 'host' | 'audience') => {
    client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });

    // 1. Supabase Edge Functionからトークンを取得
    const { data, error } = await supabase.functions.invoke('agora-token', {
      body: { channelName, uid: userId, role }
    });

    if (error) throw error;

    // 2. 役割を設定
    await client.setClientRole(role === 'host' ? "host" : "audience");

    // 3. チャンネルに参加
    await client.join(APP_ID, channelName, data.token, userId);

    // 4. ホストならマイクを公開
    if (role === 'host') {
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([localAudioTrack]);
    }

    // 5. 他の人の声を聞くためのリスナー
    client.on("user-published", async (user, mediaType) => {
      await client!.subscribe(user, mediaType);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
    });

    return client;
  };

  const leave = async () => {
    localAudioTrack?.close();
    await client?.leave();
  };

  return { join, leave };
};