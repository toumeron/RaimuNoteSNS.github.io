import { Lock, UserRound, Globe, Bot, Smile, Monitor, Sparkles, Image, Bell, Crown } from "lucide-react";
import { useSyncExternalStore } from "react";

// settingsSections
// Navigation labels reuse the existing settings headings.
const SETTINGS_SECTIONS = [
  { id: 'privacy', label: 'プライバシー', icon: Lock },
  { id: 'external', label: 'その他のSNS連携', icon: Globe },
  { id: 'automatic', label: '自動投稿の設定', icon: Bot },
  { id: 'emoji', label: '絵文字の管理', icon: Smile },
  { id: 'appearance', label: '外観の設定', icon: Monitor },
  { id: 'sharing', label: '共有', icon: UserRound },
  { id: 'effects', label: 'エフェクト設定', icon: Sparkles },
  { id: 'background', label: 'タイムライン背景', icon: Image },
  { id: 'notifications', label: '通知設定', icon: Bell },
  { id: 'pro', label: 'LimePro', icon: Crown },
  { id: 'companion', label: 'キャラクター', icon: Sparkles },
  { id: 'account', label: 'アカウント', icon: UserRound },
] as const;

const SETTINGS_GROUPS = [
 {id:'account',label:'アカウント',icon:UserRound,sections:['external','account','pro','automatic','emoji']},
 {id:'privacy',label:'プライバシー',icon:Lock,sections:['privacy']},
 {id:'display',label:'アクセシビリティ、表示',icon:Monitor,sections:['appearance','sharing','effects','background','companion']},
 {id:'notifications',label:'通知',icon:Bell,sections:['notifications']},
] as const;
const settingsGroupForSection = (id: string) => SETTINGS_GROUPS.find(group => (group.sections as readonly string[]).includes(id));

// Reuse descriptions already shown in each settings panel.
const SETTINGS_DESCRIPTIONS: Partial<Record<typeof SETTINGS_SECTIONS[number]['id'], string>> = {
  automatic: 'AIがあなたに代わって自動的に投稿を行います',
  appearance: 'LimeNoteの表示を切り替えます',
  sharing: 'ログイン中のアカウントのブックマークと通知をまとめて表示します',
  effects: '謎機能 ※空白にして更新すると消せる',
  background: 'タイムラインに表示する背景画像を設定できます。',
  pro: '開発者向けの機能です。ONにすると挙動が不安定になる場合がございますのでご注意ください。',
};

// accentTheme
const ACCENT_COLORS=[
 {id:'pink',label:'ピンク',color:'#f43f86'},
 {id:'blue',label:'ブルー',color:'#1DA1F2'},
 {id:'yellow',label:'イエロー',color:'#ffd400'},
 {id:'purple',label:'パープル',color:'#7856ff'},
 {id:'orange',label:'オレンジ',color:'#ff7a00'},
 {id:'green',label:'グリーン',color:'#00ad80'},
] as const;
type AccentColor=typeof ACCENT_COLORS[number]['id'];
const KEY='lime-accent-color',EVENT='lime-accent-change';
const valid=(value:unknown):value is AccentColor=>ACCENT_COLORS.some(c=>c.id===value);
function getAccentColor():AccentColor{try{const value=localStorage.getItem(KEY);return valid(value)?value:'pink'}catch{return 'pink'}}
function applyAccentTheme(){document.documentElement.dataset.accent=getAccentColor()}
function setAccentColor(color:AccentColor){if(!valid(color))return;try{localStorage.setItem(KEY,color)}catch{}document.documentElement.dataset.accent=color;window.dispatchEvent(new Event(EVENT));}
function subscribe(listener:()=>void){const update=()=>{applyAccentTheme();listener()};window.addEventListener(EVENT,listener);window.addEventListener('storage',update);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',update)}}
function useAccentColor(){return useSyncExternalStore(subscribe,()=>{const color=document.documentElement.dataset.accent;return valid(color)?color:getAccentColor()},()=> 'pink' as AccentColor)}

export { SETTINGS_SECTIONS };
export { SETTINGS_GROUPS };
export { settingsGroupForSection };
export { SETTINGS_DESCRIPTIONS };
export { getAccentColor };
export { applyAccentTheme };
export { setAccentColor };
export { useAccentColor };
export { ACCENT_COLORS };
export type { AccentColor };
