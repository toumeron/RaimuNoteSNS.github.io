import { UserRound, Globe, Bot, Smile, Monitor, Sparkles, Image, Bell, Crown } from 'lucide-react';

// Navigation labels reuse the existing settings headings.
export const SETTINGS_SECTIONS = [
  { id: 'external', label: 'その他のSNS連携', icon: Globe },
  { id: 'automatic', label: '自動投稿の設定', icon: Bot },
  { id: 'emoji', label: '絵文字の管理', icon: Smile },
  { id: 'appearance', label: '外観の設定', icon: Monitor },
  { id: 'effects', label: 'エフェクト設定', icon: Sparkles },
  { id: 'background', label: 'タイムライン背景', icon: Image },
  { id: 'notifications', label: '通知設定', icon: Bell },
  { id: 'pro', label: 'LimePro', icon: Crown },
  { id: 'companion', label: 'キャラクター', icon: Sparkles },
  { id: 'account', label: 'アカウント', icon: UserRound },
] as const;

export const SETTINGS_GROUPS = [
 {id:'account',label:'アカウント',icon:UserRound,sections:['external','account','pro','automatic','emoji']},
 {id:'display',label:'アクセシビリティ、表示',icon:Monitor,sections:['appearance','effects','background','companion']},
 {id:'notifications',label:'通知',icon:Bell,sections:['notifications']},
] as const;
export const settingsGroupForSection = (id: string) => SETTINGS_GROUPS.find(group => (group.sections as readonly string[]).includes(id));

// Reuse descriptions already shown in each settings panel.
export const SETTINGS_DESCRIPTIONS: Partial<Record<typeof SETTINGS_SECTIONS[number]['id'], string>> = {
  automatic: 'AIがあなたに代わって自動的に投稿を行います',
  appearance: 'LimeNoteの表示を切り替えます',
  effects: '謎機能 ※空白にして更新すると消せる',
  background: 'タイムラインに表示する背景画像を設定できます。',
  pro: '開発者向けの機能です。ONにすると挙動が不安定になる場合がございますのでご注意ください。',
};
