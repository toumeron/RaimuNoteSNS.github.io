import { useState, type FormEvent, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { z } from 'zod';
import { Heart, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/layout/Logo';
import { toast } from 'sonner';

const schema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  password: z.string().min(6, 'パスワードは6文字以上で入力してください').max(72),
});

type Mode = 'login' | 'signup';

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [isAgreed, setIsAgreed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (fe[i.path[0] as string] = i.message));
      setErrors(fe);
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('おかえりなさい');
        navigate('/');
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.user) {
          const base = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
          const username = `${base}_${Math.random().toString(36).slice(2, 6)}`;
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username,
            display_name: base,
            bio: '',
            avatar_url: '',
            cover_url: '',
          });
        }

        toast.success('ようこそLimeNoteへ！');
        navigate('/');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '処理に失敗しました';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-email`}>メールアドレス</Label>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレスを入力..."
          className="rounded-full bg-background text-foreground"
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-password`}>パスワード</Label>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="6文字以上"
          className="rounded-full bg-background text-foreground"
        />
        {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
      </div>

      {mode === 'signup' && (
        <div className="flex items-center gap-2 py-1">
          <input
            id="terms-agreement"
            type="checkbox"
            checked={isAgreed}
            onChange={(e) => setIsAgreed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-zinc-700 accent-primary cursor-pointer"
          />
          <Label 
            htmlFor="terms-agreement" 
            className="text-sm font-medium text-muted-foreground cursor-pointer select-none"
          >
            <Link 
              to="/terms" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-primary hover:underline font-semibold mr-1"
              onClick={(e) => e.stopPropagation()}
            >
              利用規約
            </Link>
            に同意する <span className="text-destructive text-xs">*</span>
          </Label>
        </div>
      )}

      <Button
        type="submit"
        disabled={busy || (mode === 'signup' && !isAgreed)}
        className="w-full rounded-full bg-gradient-primary py-6 text-base font-bold shadow-soft transition hover:scale-[1.02] hover:shadow-pop"
      >
        {mode === 'login' ? 'ログインする' : '登録してはじめる'}
      </Button>
    </form>
  );
}

export default function AuthPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // ユーザーアクションを契機にBGM（音声）のロックを解除するハンドラー
    const handleUserInteraction = () => {
      if (audioRef.current) {
        audioRef.current.play().catch((err) => {
          console.log("Audio play blocked or failed:", err);
        });
      }
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
    };

    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
    };
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 bg-black text-foreground transition-colors duration-200">
      
      {/* 背景画像：指定されたURLを全面に配置（動画と同じobject-coverでアスペクト比を維持） */}
      <img
        src="https://pbs.twimg.com/media/HHdk07nbMAAW14w?format=jpg&name=4096x4096"
        alt="Background"
        className="absolute top-0 left-0 w-full h-full object-cover z-0 pointer-events-none opacity-50"
      />

      {/* 効果音・BGM用の音声（MP3） */}
      <audio
        ref={audioRef}
        src="/background-music.mp3"
        loop
        preload="auto"
      />

      {/* コンテンツエリア（画像の上に重ねるために z-10 を指定） */}
      <div className="relative w-full max-w-md z-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          </p>
        </div>

        <div className="rounded-3xl border border-border/60 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md p-6 shadow-card-soft sm:p-8 transition-colors duration-200">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="mb-6 grid w-full grid-cols-2 rounded-full bg-secondary dark:bg-zinc-800 p-1">
              <TabsTrigger value="login" className="rounded-full data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground dark:text-zinc-400 dark:data-[state=active]:text-white">
                ログイン
              </TabsTrigger>
              <TabsTrigger value="signup" className="rounded-full data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground dark:text-zinc-400 dark:data-[state=active]:text-white">
                新規登録
              </TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <AuthForm mode="login" />
            </TabsContent>
            <TabsContent value="signup">
              <AuthForm mode="signup" />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}