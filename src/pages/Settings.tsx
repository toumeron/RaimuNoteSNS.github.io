import { useRef, useState, useEffect, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, LogOut, Moon, Sun, Monitor, Sparkles, Check, Bot, MessageSquareText, Smile, Trash2, Upload } from 'lucide-react';
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
import { User } from '@/types'; // 型定義をインポート
import { supabase } from '@/lib/supabase'; // Supabaseクライアントのインポート（環境に合わせてパスを調整してください）


const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
});

// カスタム絵文字の型定義
interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string | null;
  created_at: string;
}

export default function Settings() {
  // User型としてキャストすることで bot_enabled 等へのアクセスを可能にします
  // エラー解消のため、unknownを経由してキャストします
  const { user: authUser, logout } = useAuth();
  const user = (authUser as unknown) as User | null;

  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useUpdateProfile(user?.id ?? '');

  // 初期値の決定ロジック：DB(user) > ローカル保存(fallback)
  const getInitialEmoji = () => {
    if (user?.emojiEffect) return user.emojiEffect;
    return localStorage.getItem('lime_emoji_pref') ?? '';
  };

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl ?? '');
  const [emojiEffect, setEmojiEffect] = useState(getInitialEmoji());
  
  // Bot設定用のステート
  const [botEnabled, setBotEnabled] = useState(user?.bot_enabled ?? false);
  const [botPrompt, setBotPrompt] = useState(user?.bot_prompt ?? '');
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  // カスタム絵文字管理用のステート
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiPreview, setEmojiPreview] = useState('');
  const [isEmojiUploading, setIsEmojiUploading] = useState(false);
  const emojiInputRef = useRef<HTMLInputElement>(null);

  // カスタム絵文字の一覧を取得する関数
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

  // マウント時およびuserデータ更新時にステートを同期（リロード対策）
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setBio(user.bio ?? '');
      setAvatarUrl(user.avatarUrl ?? '');
      setCoverUrl(user.coverUrl ?? '');
      setBotEnabled(user.bot_enabled ?? false);
      setBotPrompt(user.bot_prompt ?? '');
      // user.emojiEffectがDBから降ってきたら反映。なければローカルを見る
      const currentEmoji = user.emojiEffect ?? localStorage.getItem('lime_emoji_pref') ?? '';
      setEmojiEffect(currentEmoji);
      
      // カスタム絵文字一覧の取得を実行
      fetchCustomEmojis();
    }
  }, [user]);

  if (!user) return null;

  const onPickImage = (e: ChangeEvent<HTMLInputElement>, setUrl: (s: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUrl(url);
    e.target.value = '';
  };

  // カスタム絵文字のファイル選択時の処理
  const onPickEmojiFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEmojiFile(file);
    const url = URL.createObjectURL(file);
    setEmojiPreview(url);
  };

  // カスタム絵文字のアップロードとDB登録処理
  const handleUploadCustomEmoji = async () => {
    if (!emojiName.trim()) {
      toast.error('絵文字名を入力してください');
      return;
    }
    if (!emojiFile) {
      toast.error('画像ファイルを選択してください');
      return;
    }

    // 前後のコロン処理の自動補正
    let formattedName = emojiName.trim();
    if (!formattedName.startsWith(':')) formattedName = `:${formattedName}`;
    if (!formattedName.endsWith(':')) formattedName = `${formattedName}:`;

    // 命名規則の正規表現バリデーション
    const nameRegex = /^:[a-zA-Z0-9_\-]+:$/;
    if (!nameRegex.test(formattedName) || formattedName.length < 3) {
      toast.error('絵文字名は英数字、アンダースコア、ハイフンのみを使用し、前後にコロンを付けてください（例: :my_emoji:）');
      return;
    }

    setIsEmojiUploading(true);

    try {
      // 1. Cloudinaryへのアップロード処理
      // ※環境変数等からCloudinaryの設定情報を読み込んでください
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

      // 2. Supabase DBへの登録処理
      const { error: dbError } = await supabase
        .from('custom_emojis')
        .insert([
          {
            name: formattedName,
            public_id: clData.public_id,
            format: clData.format,
            uploaded_by: user.id
          }
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
      if (emojiInputRef.current) emojiInputRef.current.value = '';
      
      // 一覧を再取得
      await fetchCustomEmojis();
    } catch (err: any) {
      console.error('Emoji Upload Error:', err);
      toast.error(err.message || 'カスタム絵文字の登録に失敗しました');
    } finally {
      setIsEmojiUploading(false);
    }
  };

  // カスタム絵文字の削除処理
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

  // 絵文字専用の更新処理
  const updateEmojiOnly = async () => {
    // 文字数制限のチェック（サロゲートペア対応）
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
        bot_prompt: botPrompt
      });
      localStorage.setItem('lime_emoji_pref', emojiEffect);
      toast.success('エフェクト設定を更新しました');
    } catch (err) {
      console.error("Emoji Update Error:", err);
      toast.error('エフェクトの保存に失敗しました');
    }
  };

  // Bot設定専用の更新処理（切り替え時・ボタン押下時共通）
  const updateBotSettings = async (nextEnabled?: boolean) => {
    // 引数があればそれを使用し、なければ現在のステートを使用する
    const targetEnabled = nextEnabled !== undefined ? nextEnabled : botEnabled;
    
    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: targetEnabled,
        bot_prompt: botPrompt
      });
    } catch (err) {
      console.error("Bot Update Error:", err);
      toast.error('Bot設定の保存に失敗しました');
      // 失敗した場合はステートを戻す（UI上の不整合を防ぐ）
      setBotEnabled(!targetEnabled);
    }
  };

  // Switch切り替え時のハンドラ
  const handleBotSwitchChange = async (checked: boolean) => {
    setBotEnabled(checked);
    // 即時更新を実行
    await updateBotSettings(checked);
  };

  const submit = async () => {
    const parsed = schema.safeParse({ displayName, bio });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (fe[i.path[0] as string] = i.message));
      setErrors(fe);
      return;
    }
    
    // 絵文字のバリデーションをメインの保存時にも適用
    const emojiCount = Array.from(emojiEffect).length;
    if (emojiCount > 1) {
      toast.error('エフェクトには1文字だけ入力してください');
      return;
    }

    setErrors({});
    
    try {
      // 1. DB（Supabase）へ保存
      await mutateAsync({ 
        displayName, 
        bio, 
        avatarUrl, 
        coverUrl, 
        emojiEffect,
        bot_enabled: botEnabled,
        bot_prompt: botPrompt
      });
      
      // 2. ローカルストレージへ保存（リロード時の保険・即時反映用）
      localStorage.setItem('lime_emoji_pref', emojiEffect);
      
      toast.success('プロフィールを更新しました');
    } catch (err) {
      console.error("Settings Update Error:", err);
      toast.error('保存に失敗しました。DBのカラム名を確認してください。');
    }
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

      {/* Bot設定セクション */}
      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-bold">自動投稿の設定</h2>
          </div>
          <Switch 
            checked={botEnabled}
            onCheckedChange={handleBotSwitchChange}
          />
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

      {/* カスタム絵文字管理セクション */}
      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">絵文字の管理</h2>
        </div>

        {/* アップロードフォーム */}
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

        {/* 登録済み絵文字一覧 */}
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground">登録済みのカスタム絵文字（{customEmojis.length}個）</h3>
          {customEmojis.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">登録されているカスタム絵文字はありません。</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-60 overflow-y-auto p-1 border border-border/40 rounded-2xl bg-background/30">
              {customEmojis.map((emoji) => {
                // Cloudinaryの最適化パラメータを付与したURLを生成
                const optimizedUrl = `https://res.cloudinary.com/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,w_48,h_48,c_limit/${emoji.public_id}.${emoji.format}`;
                return (
                  <div key={emoji.id} className="flex items-center justify-between p-2 rounded-xl border border-border/40 bg-card shadow-sm">
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

      {/* 外観設定セクション */}
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

      {/* エフェクト設定セクション */}
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

      {/* アカウントセクション */}
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