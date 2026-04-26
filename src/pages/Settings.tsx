import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { useUpdateProfile } from '@/hooks/useProfile';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';

const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
});

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useUpdateProfile(user?.id ?? '');

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const onPickImage = (e: ChangeEvent<HTMLInputElement>, setUrl: (s: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // TODO: Supabase Storage にアップロードして公開URLを setUrl に渡す
    const url = URL.createObjectURL(file);
    setUrl(url);
    e.target.value = '';
  };

  const submit = async () => {
    const parsed = schema.safeParse({ displayName, bio });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (fe[i.path[0] as string] = i.message));
      setErrors(fe);
      return;
    }
    setErrors({});
    try {
      await mutateAsync({ displayName, bio, avatarUrl, coverUrl });
    } catch {/* hookでtoast */}
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-black">プロフィール編集</h1>

      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-soft">
        {/* カバー */}
        <div className="relative h-40 bg-gradient-cream sm:h-48">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center bg-foreground/30 text-primary-foreground opacity-0 transition hover:opacity-100"
          >
            <ImagePlus className="mr-2 h-5 w-5" /> カバー画像を変更
          </button>
          <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => onPickImage(e, setCoverUrl)} />
        </div>

        <div className="px-5 pb-6 pt-3 sm:px-6">
          {/* アバター */}
          <div className="-mt-12 flex items-end gap-3 sm:-mt-14">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-card shadow-pop sm:h-28 sm:w-28">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="absolute bottom-0 right-0 rounded-full bg-gradient-primary p-2 text-primary-foreground shadow-soft transition hover:scale-110"
                aria-label="アイコン変更"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => onPickImage(e, setAvatarUrl)} />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                className="rounded-full bg-background"
              />
              {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">ユーザー名</Label>
              <Input id="username" value={user.username} disabled className="rounded-full bg-muted" />
              <p className="text-xs text-muted-foreground">※ ユーザー名は変更できません</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bio">自己紹介</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={200}
                className="resize-none rounded-2xl"
              />
              <div className="flex justify-end">
                <span className={`text-xs ${bio.length > 160 ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>
                  {bio.length} / 160
                </span>
              </div>
              {errors.bio && <p className="text-xs text-destructive">{errors.bio}</p>}
            </div>

            <Button
              onClick={submit}
              disabled={isPending}
              className="w-full rounded-full bg-gradient-primary py-6 font-bold shadow-soft hover:shadow-pop"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存する'}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-bold">アカウント</h2>
        <p className="mt-1 text-sm text-muted-foreground">ログアウトすると認証画面に戻ります。</p>
        <Button
          variant="outline"
          className="mt-4 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            logout();
            toast.success('ログアウトしました');
            navigate('/auth');
          }}
        >
          <LogOut className="mr-1.5 h-4 w-4" /> ログアウト
        </Button>
      </div>
    </div>
  );
}
