import { createContext, useContext } from 'react';
export type SpeakerPolicy = 'everyone' | 'host' | 'following';
export type LiveSpace = { id: string; title: string; host_id: string; speaker_policy: SpeakerPolicy; profiles: { display_name: string; username: string; avatar_url: string } };
export type SpaceMember = { id: string; display_name: string; username?: string; avatar_url: string; role: 'host' | 'speaker' | 'listener'; muted?: boolean; requested?: boolean; rtc_uid?: number };
export const SpaceContext = createContext<{ spaces: LiveSpace[]; open: (id: string) => void; create: () => void }>({ spaces: [], open: () => {}, create: () => {} });
export const useSpaces = () => useContext(SpaceContext);
