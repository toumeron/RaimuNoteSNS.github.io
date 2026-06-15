import { useRef, useState, useEffect, type ChangeEvent } from 'react';
import {
  ImagePlus,
  Loader2,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Sparkles,
  Check,
  Bot,
  MessageSquareText,
  Smile,
  Trash2,
  Upload,
  Crown,
  CreditCard
} from 'lucide-react';
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
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { User } from '@/types';
import { supabase } from '@/lib/supabase';

const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
});

interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string | null;
  created_at: string;
}

export default function Settings() {
  const { user: authUser, logout } = useAuth();
  const user = (authUser as unknown) as User | null;

  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useUpdateProfile(user?.id ?? '');

  const getInitialEmoji = () => {
    if (user?.emojiEffect) return user.emojiEffect;
    return localStorage.getItem('lime_emoji_pref') ?? '';
  };

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl ?? '');
  const [timelineBackgroundUrl, setTimelineBackgroundUrl] = useState(
    (user as any)?.timelineBackgroundUrl ??
      (user as any)?.timeline_background_url ??
      localStorage.getItem('lime_timeline_background_url') ??
      ''
  );
  const [timelineBackgroundPublicId, setTimelineBackgroundPublicId] = useState(
    (user as any)?.timelineBackgroundPublicId ?? (user as any)?.timeline_background_public_id ?? ''
  );
  const [isTimelineBackgroundUploading, setIsTimelineBackgroundUploading] = useState(false);
  const [isTimelineBackgroundLoading, setIsTimelineBackgroundLoading] = useState(false);
  const [emojiEffect, setEmojiEffect] = useState(getInitialEmoji());

  const [botEnabled, setBotEnabled] = useState(user?.bot_enabled ?? false);
  const [botPrompt, setBotPrompt] = useState(user?.bot_prompt ?? '');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const timelineBackgroundRef = useRef<HTMLInputElement>(null);

  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiPreview, setEmojiPreview] = useState('');
  const [isEmojiUploading, setIsEmojiUploading] = useState(false);
  const emojiInputRef = useRef<HTMLInputElement>(null);

  const [hasLimePro, setHasLimePro] = useState(false);
  const [isLimeProPurchasing, setIsLimeProPurchasing] = useState(false);

  const fetchCustomEmojis = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setCustomEmojis(data as CustomEmoji[]);
    } catch (err) {
      console.error('Fetch Emojis Error:', err);
    }
  };

  const fetchLimeProStatus = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_entitlements')
        .select('feature')
        .eq('user_id', user.id)
        .eq('feature', 'limepro')
        .maybeSingle();

      if (error) throw error;

      setHasLimePro(!!data);
    } catch (err) {
      console.error('Fetch LimePro Status Error:', err);
    }
  };

  const applyTimelineBackgroundState = (url: string, publicId = '') => {
    setTimelineBackgroundUrl(url);
    setTimelineBackgroundPublicId(publicId);

    if (url) {
      localStorage.setItem('lime_timeline_background_url', url);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }
  };

  const fetchTimelineBackgroundSetting = async () => {
    if (!user?.id) return;

    setIsTimelineBackgroundLoading(true);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('timeline_background_url, timeline_background_public_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      const url = data?.timeline_background_url ?? '';
      const publicId = data?.timeline_background_public_id ?? '';

      applyTimelineBackgroundState(url, publicId);
    } catch (err) {
      console.error('Fetch Timeline Background Error:', err);

      const fallbackUrl =
        (user as any)?.timelineBackgroundUrl ??
        (user as any)?.timeline_background_url ??
        localStorage.getItem('lime_timeline_background_url') ??
        '';
      const fallbackPublicId =
        (user as any)?.timelineBackgroundPublicId ??
        (user as any)?.timeline_background_public_id ??
        '';

      applyTimelineBackgroundState(fallbackUrl, fallbackPublicId);
    } finally {
      setIsTimelineBackgroundLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setBio(user.bio ?? '');
      setAvatarUrl(user.avatarUrl ?? '');
      setCoverUrl(user.coverUrl ?? '');

      const localTimelineBackgroundUrl = localStorage.getItem('lime_timeline_background_url') ?? '';
      const userTimelineBackgroundUrl =
        (user as any)?.timelineBackgroundUrl ?? (user as any)?.timeline_background_url ?? '';
      const userTimelineBackgroundPublicId =
        (user as any)?.timelineBackgroundPublicId ?? (user as any)?.timeline_background_public_id ?? '';

      applyTimelineBackgroundState(
        userTimelineBackgroundUrl || localTimelineBackgroundUrl,
        userTimelineBackgroundPublicId
      );

      setBotEnabled(user.bot_enabled ?? false);
      setBotPrompt(user.bot_prompt ?? '');

      const currentEmoji = user.emojiEffect ?? localStorage.getItem('lime_emoji_pref') ?? '';
      setEmojiEffect(currentEmoji);

      fetchCustomEmojis();
      fetchLimeProStatus();
      fetchTimelineBackgroundSetting();
    }
  }, [user?.id]);

  if (!user) return null;

  const onPickImage = (e: ChangeEvent<HTMLInputElement>, setUrl: (s: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUrl(url);
    e.target.value = '';
  };

  const notifyTimelineBackgroundChanged = (url: string) => {
    if (url) {
      localStorage.setItem('lime_timeline_background_url', url);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }

    window.dispatchEvent(
      new CustomEvent('timeline-background-changed', {
        detail: { url },
      })
    );

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('timeline-background');
      channel.postMessage({ url });
      channel.close();
    }
  };

  const handleTimelineBackgroundUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('背景には画像ファイルを選択してください');
      return;
    }

    const maxSize = 8 * 1024 * 1024;

    if (file.size > maxSize) {
      toast.error('背景画像は8MB以下にしてください');
      return;
    }

    setIsTimelineBackgroundUploading(true);

    try {
      const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

      if (!cloudinaryCloudName || !uploadPreset) {
        throw new Error('Cloudinaryの環境設定が不足しています');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', `timeline_backgrounds/${user.id}`);

      const clRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!clRes.ok) throw new Error('Cloudinaryへのアップロードに失敗しました');

      const clData = await clRes.json();
      const uploadedUrl = clData.secure_url as string;
      const uploadedPublicId = clData.public_id as string;

      const { error } = await supabase
        .from('profiles')
        .update({
          timeline_background_url: uploadedUrl,
          timeline_background_public_id: uploadedPublicId,
        })
        .eq('id', user.id);

      if (error) throw error;

      applyTimelineBackgroundState(uploadedUrl, uploadedPublicId);
      notifyTimelineBackgroundChanged(uploadedUrl);

      toast.success('タイムライン背景を更新しました');
    } catch (err: any) {
      console.error('Timeline Background Upload Error:', err);
      toast.error(err.message || 'タイムライン背景の更新に失敗しました');
    } finally {
      setIsTimelineBackgroundUploading(false);
    }
  };

  const handleRemoveTimelineBackground = async () => {
    if (!timelineBackgroundUrl) return;

    setIsTimelineBackgroundUploading(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          timeline_background_url: null,
          timeline_background_public_id: null,
        })
        .eq('id', user.id);

      if (error) throw error;

      applyTimelineBackgroundState('', '');
      notifyTimelineBackgroundChanged('');

      toast.success('タイムライン背景を削除しました');
    } catch (err) {
      console.error('Timeline Background Remove Error:', err);
      toast.error('タイムライン背景の削除に失敗しました');
    } finally {
      setIsTimelineBackgroundUploading(false);
    }
  };

  const onPickEmojiFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEmojiFile(file);
    const url = URL.createObjectURL(file);
    setEmojiPreview(url);
  };

  const handleUploadCustomEmoji = async () => {
    if (!emojiName.trim()) {
      toast.error('絵文字名を入力してください');
      return;
    }

    if (!emojiFile) {
      toast.error('画像ファイルを選択してください');
      return;
    }

    let formattedName = emojiName.trim();
    if (!formattedName.startsWith(':')) formattedName = `:${formattedName}`;
    if (!formattedName.endsWith(':')) formattedName = `${formattedName}:`;

    const nameRegex = /^:[a-zA-Z0-9_\-]+:$/;
    if (!nameRegex.test(formattedName) || formattedName.length < 3) {
      toast.error('絵文字名は英数字、アンダースコア、ハイフンのみを使用し、前後にコロンを付けてください（例: :my_emoji:）');
      return;
    }

    setIsEmojiUploading(true);

    try {
      const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

      if (!cloudinaryCloudName || !uploadPreset) {
        throw new Error('Cloudinaryの環境設定が不足しています');
      }

      const formData = new FormData();
      formData.append('file', emojiFile);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', 'custom_emojis');

      const clRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!clRes.ok) throw new Error('Cloudinaryへのアップロードに失敗しました');

      const clData = await clRes.json();

      const { error: dbError } = await supabase
        .from('custom_emojis')
        .insert([
          {
            name: formattedName,
            public_id: clData.public_id,
            format: clData.format,
            uploaded_by: user.id,
          },
        ]);

      if (dbError) {
        if (dbError.code === '23505') {
          toast.error(`「${formattedName}」は既に登録されています。別の名前を入力してください。`);
          return;
        }

        throw dbError;
      }

      toast.success('カスタム絵文字を登録しました');
      setEmojiName('');
      setEmojiFile(null);
      setEmojiPreview('');

      if (emojiInputRef.current) {
        emojiInputRef.current.value = '';
      }

      await fetchCustomEmojis();
    } catch (err: any) {
      console.error('Emoji Upload Error:', err);
      toast.error(err.message || 'カスタム絵文字の登録に失敗しました');
    } finally {
      setIsEmojiUploading(false);
    }
  };

  const handleDeleteCustomEmoji = async (id: string) => {
    if (!confirm('このカスタム絵文字を削除しますか？関連するすべてのリアクションも削除されます。')) return;

    try {
      const { error } = await supabase
        .from('custom_emojis')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('カスタム絵文字を削除しました');
      await fetchCustomEmojis();
    } catch (err) {
      console.error('Delete Emoji Error:', err);
      toast.error('カスタム絵文字の削除に失敗しました');
    }
  };

const handleDummyLimeProPurchase = async () => {
  if (!user?.id) return;

  const previousStatus = hasLimePro;
  const nextStatus = !hasLimePro;

  const notifyLimeProStatus = (status: boolean) => {
    setHasLimePro(status);
    localStorage.setItem('limepro_status', String(status));

    window.dispatchEvent(
      new CustomEvent('limepro-status-changed', {
        detail: { hasLimePro: status },
      })
    );

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('limepro-status');
      channel.postMessage({ hasLimePro: status });
      channel.close();
    }
  };

  setIsLimeProPurchasing(true);

  // ここが重要：DB完了を待たず、先にロゴ表示を切り替える
  notifyLimeProStatus(nextStatus);

  try {
    if (nextStatus) {
      const { error } = await supabase
        .from('user_entitlements')
        .insert({
          user_id: user.id,
          feature: 'limepro',
        });

      if (error) {
        if (error.code === '23505') {
          notifyLimeProStatus(true);
          toast.info('すでにLimeProが有効です');
          return;
        }

        throw error;
      }

      toast.success('LimeProを有効化しました');
      return;
    }

    const { error } = await supabase
      .from('user_entitlements')
      .delete()
      .eq('user_id', user.id)
      .eq('feature', 'limepro');

    if (error) throw error;

    toast.success('LimeProを解約しました');
  } catch (err) {
    console.error('Dummy LimePro Purchase Error:', err);

    // DB処理が失敗したら表示を元に戻す
    notifyLimeProStatus(previousStatus);

    toast.error(nextStatus ? 'LimeProの有効化に失敗しました' : 'LimeProの解約に失敗しました');
  } finally {
    setIsLimeProPurchasing(false);
  }
};


  const updateEmojiOnly = async () => {
    const emojiCount = Array.from(emojiEffect).length;

    if (emojiCount > 1) {
      toast.error('エフェクトには1文字だけ入力してください');
      return;
    }

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: botEnabled,
        bot_prompt: botPrompt,
      });

      localStorage.setItem('lime_emoji_pref', emojiEffect);
      toast.success('エフェクト設定を更新しました');
    } catch (err) {
      console.error('Emoji Update Error:', err);
      toast.error('エフェクトの保存に失敗しました');
    }
  };

  const updateBotSettings = async (nextEnabled?: boolean) => {
    const targetEnabled = nextEnabled !== undefined ? nextEnabled : botEnabled;

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: targetEnabled,
        bot_prompt: botPrompt,
      });
    } catch (err) {
      console.error('Bot Update Error:', err);
      toast.error('Bot設定の保存に失敗しました');
      setBotEnabled(!targetEnabled);
    }
  };

  const handleBotSwitchChange = async (checked: boolean) => {
    setBotEnabled(checked);
    await updateBotSettings(checked);
  };

  const submit = async () => {
    const parsed = schema.safeParse({ displayName, bio });

    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        fe[i.path[0] as string] = i.message;
      });
      setErrors(fe);
      return;
    }

    const emojiCount = Array.from(emojiEffect).length;

    if (emojiCount > 1) {
      toast.error('エフェクトには1文字だけ入力してください');
      return;
    }

    setErrors({});

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: botEnabled,
        bot_prompt: botPrompt,
      });

      localStorage.setItem('lime_emoji_pref', emojiEffect);

      toast.success('プロフィールを更新しました');
    } catch (err) {
      console.error('Settings Update Error:', err);
      toast.error('保存に失敗しました。DBのカラム名を確認してください。');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-black">プロフィール編集</h1>

      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-soft">
        <div className="relative h-40 bg-gradient-cream sm:h-48">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}

          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center bg-foreground/30 text-primary-foreground opacity-0 transition hover:opacity-100"
          >
            <ImagePlus className="mr-2 h-5 w-5" /> カバー画像を変更
          </button>

          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPickImage(e, setCoverUrl)}
          />
        </div>

        <div className="px-5 pb-6 pt-3 sm:px-6">
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
              >
                <ImagePlus className="h-4 w-4" />
              </button>

              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onPickImage(e, setAvatarUrl)}
              />
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-bold">自動投稿の設定</h2>
          </div>

          <Switch checked={botEnabled} onCheckedChange={handleBotSwitchChange} />
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          AIがあなたに代わって自動的に投稿を行います
        </p>

        {botEnabled && (
          <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
                <Label htmlFor="botPrompt">性格・指示</Label>
              </div>

              <Textarea
                id="botPrompt"
                value={botPrompt}
                onChange={(e) => setBotPrompt(e.target.value)}
                placeholder="例:猫が好きな人として振る舞ってください"
                rows={3}
                className="resize-none rounded-2xl bg-background"
              />

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                ※ AIへの指示を入力してください。この指示に基づいて自動投稿が生成されます。
              </p>
            </div>

            <Button
              onClick={() => updateBotSettings()}
              disabled={isPending}
              variant="secondary"
              className="w-full rounded-full font-bold shadow-sm"
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              自動投稿の設定を更新
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">絵文字の管理</h2>
        </div>

        <div className="mt-4 space-y-4 rounded-2xl border border-border/40 p-4 bg-background/50">
          <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <Upload className="h-3 w-3" /> 新規絵文字の登録
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emojiName">絵文字名</Label>
              <Input
                id="emojiName"
                value={emojiName}
                onChange={(e) => setEmojiName(e.target.value)}
                placeholder="例:Nakkar"
                className="rounded-full bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label>画像ファイル</Label>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => emojiInputRef.current?.click()}
                  className="rounded-full border-dashed"
                >
                  画像を選択
                </Button>

                <input
                  ref={emojiInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/gif, image/webp"
                  hidden
                  onChange={onPickEmojiFile}
                />

                {emojiPreview && (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border/40 overflow-hidden">
                    <img src={emojiPreview} alt="Preview" className="h-full w-full object-contain" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleUploadCustomEmoji}
            disabled={isEmojiUploading || !emojiName || !emojiFile}
            className="w-full rounded-full bg-gradient-primary font-bold shadow-soft"
          >
            {isEmojiUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            絵文字をアップロードして登録
          </Button>
        </div>

        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground">
            登録済みのカスタム絵文字（{customEmojis.length}個）
          </h3>

          {customEmojis.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              登録されているカスタム絵文字はありません。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-60 overflow-y-auto p-1 border border-border/40 rounded-2xl bg-background/30">
              {customEmojis.map((emoji) => {
                const optimizedUrl = `https://res.cloudinary.com/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,w_48,h_48,c_limit/${emoji.public_id}.${emoji.format}`;

                return (
                  <div
                    key={emoji.id}
                    className="flex items-center justify-between p-2 rounded-xl border border-border/40 bg-card shadow-sm"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted border border-border/20">
                        <img src={optimizedUrl} alt={emoji.name} className="h-full w-full object-contain" />
                      </div>

                      <span className="text-xs font-mono truncate text-foreground/80" title={emoji.name}>
                        {emoji.name}
                      </span>
                    </div>

                    {emoji.uploaded_by === user.id && (
                      <button
                        onClick={() => handleDeleteCustomEmoji(emoji.id)}
                        className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                        title="削除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-bold">外観の設定</h2>
        <p className="mt-1 text-sm text-muted-foreground">LimeNoteの表示を切り替えます</p>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-muted p-1">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'light' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sun className="h-4 w-4" /> ライト
          </button>

          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'dark' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Moon className="h-4 w-4" /> ダーク
          </button>

          <button
            onClick={() => setTheme('system')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'system' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Monitor className="h-4 w-4" /> システム
          </button>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">エフェクト設定</h2>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">謎機能 ※空白にして更新すると消せる</p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="emojiEffect">降らせる文字</Label>

              <div className="relative">
                <Input
                  id="emojiEffect"
                  value={emojiEffect}
                  onChange={(e) => setEmojiEffect(e.target.value)}
                  placeholder="絵文字を入力..."
                  className="rounded-full bg-background pr-10"
                />

                {emojiEffect && (
                  <button
                    onClick={() => setEmojiEffect('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    クリア
                  </button>
                )}
              </div>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-2xl shadow-inner border border-border/40">
              {emojiEffect ? Array.from(emojiEffect)[0] : '？'}
            </div>
          </div>

          <Button
            onClick={updateEmojiOnly}
            disabled={isPending}
            variant="secondary"
            className="w-full rounded-full font-bold shadow-sm"
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            エフェクトを更新
          </Button>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background text-primary shadow-sm">
            <Crown className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold">LimePro</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                hasLimePro
                  ? 'bg-primary-soft text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {hasLimePro ? '有効' : '未加入'}
              </span>
            </div>

            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              ベータ版
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
            </div>
          </div>
        </div>

        <Button
          onClick={handleDummyLimeProPurchase}
          disabled={isLimeProPurchasing}
          variant={hasLimePro ? 'outline' : 'default'}
          className={`mt-5 w-full rounded-full py-6 font-bold shadow-sm ${
            hasLimePro
              ? 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
              : 'bg-gradient-primary hover:shadow-pop'
          }`}
        >
          {isLimeProPurchasing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : hasLimePro ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <CreditCard className="mr-2 h-4 w-4" />
          )}

          {isLimeProPurchasing
            ? '処理中...'
            : hasLimePro
              ? 'LimeProを無効化'
              : 'LimeProを有効化'}
        </Button>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background text-primary shadow-sm">
            <ImagePlus className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold">タイムライン背景(Beta)</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              タイムラインに表示する背景画像を設定できます。
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-border/60 bg-muted">
          <div
            className="relative flex h-44 items-center justify-center bg-gradient-cream bg-cover bg-center sm:h-56"
            style={
              timelineBackgroundUrl
                ? { backgroundImage: `url(${timelineBackgroundUrl})` }
                : undefined
            }
          >
            {timelineBackgroundUrl && (
              <div className="absolute inset-0 bg-background/10 backdrop-blur-md" />
            )}

            <div className="relative z-10 rounded-full border border-border/60 bg-card/70 px-4 py-2 text-xs font-bold text-foreground shadow-soft backdrop-blur-md">
              {isTimelineBackgroundLoading
                ? '背景設定を確認中...'
                : timelineBackgroundUrl
                  ? '現在の背景プレビュー'
                  : '背景未設定'}
            </div>
          </div>
        </div>

        <input
          ref={timelineBackgroundRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleTimelineBackgroundUpload}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => timelineBackgroundRef.current?.click()}
            disabled={isTimelineBackgroundUploading || isTimelineBackgroundLoading}
            className="rounded-full bg-gradient-primary font-bold shadow-soft hover:shadow-pop"
          >
            {isTimelineBackgroundUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {timelineBackgroundUrl ? '背景を変更' : '背景をアップロード'}
          </Button>

          {timelineBackgroundUrl && (
            <Button
              type="button"
              variant="outline"
              onClick={handleRemoveTimelineBackground}
              disabled={isTimelineBackgroundUploading || isTimelineBackgroundLoading}
              className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              背景を削除
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-bold">アカウント</h2>
        <p className="mt-1 text-sm text-muted-foreground">ログアウトすると認証画面に戻ります</p>

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