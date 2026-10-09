import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useUpdateProfile } from '@/hooks/useProfile';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { z } from 'zod';
import './profile-editor.css';
import { ProfileImageCropper, type ProfileImageCropTarget } from './ProfileImageCropper';
const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
  location: z.string().trim().max(100, '場所は100文字以内で入力してください'),
});

export default function ProfileEditor({onSaved}:{onSaved:()=>void}) {
 const {user}=useAuth();
 const {mutateAsync,isPending}=useUpdateProfile(user?.id??'');
 const [displayName,setDisplayName]=useState(user?.displayName??'');
 const [bio,setBio]=useState(user?.bio??'');
 const [location,setLocation]=useState(user?.location??'');
 const [avatarUrl,setAvatarUrl]=useState(user?.avatarUrl??'');
 const [coverUrl,setCoverUrl]=useState(user?.coverUrl??'');
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [isProfileLoading,setIsProfileLoading]=useState(true);
 const avatarRef=useRef<HTMLInputElement>(null),coverRef=useRef<HTMLInputElement>(null);
 const [profileCropTarget,setProfileCropTarget]=useState<ProfileImageCropTarget|null>(null);
 const [profileCropSrc,setProfileCropSrc]=useState('');
 const dialogRef=useRef<HTMLDivElement>(null);
 const profileCropObjectUrlRef=useRef<string|null>(null);
 useEffect(()=>{
  let active=true;
  if(user?.id)void Promise.resolve(supabase.from('profiles').select('display_name,bio,location,avatar_url,cover_url').eq('id',user.id).maybeSingle()).then(({data,error})=>{
   if(!active)return;
   if(error){toast.error('プロフィールを読み込めませんでした');return;}
   if(data){setDisplayName(data.display_name??'');setBio(data.bio??'');setLocation(data.location??'');setAvatarUrl(data.avatar_url??'');setCoverUrl(data.cover_url??'');}
  }).catch(()=>{if(active)toast.error('プロフィールを読み込めませんでした');}).finally(()=>{if(active)setIsProfileLoading(false);});
  return()=>{active=false;if(profileCropObjectUrlRef.current)URL.revokeObjectURL(profileCropObjectUrlRef.current);};
 },[user?.id]);
  const onPickImage = (e: ChangeEvent<HTMLInputElement>, target: ProfileImageCropTarget) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('画像ファイルを選択してください');
      return;
    }

    if (profileCropObjectUrlRef.current) {
      URL.revokeObjectURL(profileCropObjectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    profileCropObjectUrlRef.current = url;
    setProfileCropTarget(target);
    setProfileCropSrc(url);
  };

  const closeProfileCrop = () => {
    setProfileCropTarget(null);
    setProfileCropSrc('');
    if (profileCropObjectUrlRef.current) {
      URL.revokeObjectURL(profileCropObjectUrlRef.current);
      profileCropObjectUrlRef.current = null;
    }
  };

  const applyProfileCrop = (url: string) => {
    if (profileCropTarget === 'avatar') {
      setAvatarUrl(url);
    } else if (profileCropTarget === 'cover') {
      setCoverUrl(url);
    }
    closeProfileCrop();
  };


 const submit=async()=>{
  const parsed=schema.safeParse({displayName,bio,location});
  if(!parsed.success){const next:Record<string,string>={};parsed.error.issues.forEach(issue=>{next[issue.path[0] as string]=issue.message;});setErrors(next);return;}
  setErrors({});
  try{await mutateAsync({...parsed.data,avatarUrl,coverUrl});toast.success('プロフィールを更新しました');onSaved();}
  catch{toast.error('保存に失敗しました。DBのカラム名を確認してください。');}
 };
 if(!user)return null;
 return <DialogContent ref={dialogRef} onInteractOutside={event=>event.preventDefault()} aria-describedby={undefined} className="profile-editor z-[2147483200] flex h-[90dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden max-sm:inset-0 max-sm:data-[state=open]:animate-none max-sm:data-[state=closed]:animate-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-2xl">
 <div className="profile-editor-header">
  <DialogClose asChild><Button variant="ghost" size="icon" className="profile-editor-cancel shrink-0 rounded-full" aria-label="閉じる"><X className="hidden h-5 w-5 sm:block" /><span className="sm:hidden">キャンセル</span></Button></DialogClose>
  <DialogTitle className="min-w-0 flex-1 truncate text-base max-[360px]:text-sm sm:text-lg font-bold">プロフィールを編集</DialogTitle>
  <Button onClick={submit} disabled={isPending || isProfileLoading} className="rounded-full bg-foreground px-5 font-bold text-background hover:bg-foreground/90">{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存する'}</Button>
 </div>
 <div className="profile-editor-scroll" data-profile-editor-scroll>
      <div className="profile-editor-body">
        <div className="relative h-40 bg-gradient-cream sm:h-48">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="カバー画像を変更"
          >
            <span className="profile-editor-camera"><Camera className="h-5 w-5" /></span>
          </button>
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPickImage(e, 'cover')}
          />
        </div>

        <div className="profile-editor-details px-5 pb-6 pt-3 sm:px-6">
          <div className="profile-editor-avatar -mt-12 flex items-end gap-3 sm:-mt-14">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-card shadow-pop sm:h-28 sm:w-28">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="profile-editor-camera absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                aria-label="アイコンを変更"
              >
                <Camera className="h-5 w-5" />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onPickImage(e, 'avatar')}
              />
            </div>
          </div>

          <div className="profile-editor-fields mt-6 space-y-4">
            <div className="profile-editor-field">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                className="profile-editor-input"
              />
              {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
            </div>

            <div className="profile-editor-field">
              <Label htmlFor="username">ユーザー名</Label>
              <Input id="username" value={user.username} disabled className="profile-editor-input" />
              <p className="text-xs text-muted-foreground">※ ユーザー名は変更できません</p>
            </div>

            <div className="profile-editor-field">
              <Label htmlFor="bio">自己紹介</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={200}
                className="profile-editor-input resize-none"
              />
              <div className="flex justify-end">
                <span
                  className={`text-xs ${bio.length > 160 ? 'font-bold text-destructive' : 'text-muted-foreground'}`}
                >
                  {bio.length} / 160
                </span>
              </div>
              {errors.bio && <p className="text-xs text-destructive">{errors.bio}</p>}
            </div>

            <div className="profile-editor-field">
              <Label htmlFor="profile-location">場所</Label>
              <Input
                id="profile-location"
                disabled={isProfileLoading}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={100}
                className="profile-editor-input"
              />
              {errors.location && <p className="text-xs text-destructive">{errors.location}</p>}
            </div>


          </div>
        </div>
      </div>


 </div>
 {profileCropTarget&&profileCropSrc&&<ProfileImageCropper src={profileCropSrc} target={profileCropTarget} onApply={applyProfileCrop} onClose={closeProfileCrop} portalContainer={dialogRef.current??undefined}/>}
 </DialogContent>;
}
