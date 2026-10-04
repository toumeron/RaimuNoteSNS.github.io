import type {LinkPreview} from '@/lib/linkPreview';
import type {OfflineSpaceCard} from '@/lib/offlineBookmarks';
import {createContext} from 'react';
import type {CustomSticker} from '@/lib/stickers';
export const OfflineBookmarkContext=createContext<{bookmarkIds:string[];linkPreviews?:Record<string,LinkPreview|null>;emojis:CustomSticker[];spaces:Record<string,OfflineSpaceCard|null>;media:Map<string,string>}|null>(null);
