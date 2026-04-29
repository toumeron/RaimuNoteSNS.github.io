import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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

        // サインアップ成功時に profiles テーブルへ行を作成
        if (data.user) {
          const base = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
          // username の重複を避けるため末尾に短いランダム文字列を付加
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
          className="rounded-full bg-background"
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
          className="rounded-full bg-background"
        />
        {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-gradient-primary py-6 text-base font-bold shadow-soft transition hover:scale-[1.02] hover:shadow-pop"
      >
        {mode === 'login' ? 'ログインする' : '登録してはじめる'}
      </Button>
    </form>
  );
}

export default function AuthPage() {
  return (
    /* bg-white を追加し、全体の背景を白に固定 */
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 bg-white">
      {/* ここにあった背景画像(confetti-bg)や、
          ピンク/ブルーのボカシ(blur-3xl)、
          浮いているハート(Heart)をすべて削除しました 
      */}

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Beta
            <Sparkles className="h-3.5 w-3.5 text-accent" />
          </p>
        </div>

        {/* カード部分の bg-card/90 や backdrop-blur-md も
            白背景なら不要なので、シンプルな border だけにしても綺麗です 
        */}
        <div className="rounded-3xl border border-border/60 bg-white p-6 shadow-card-soft sm:p-8">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="mb-6 grid w-full grid-cols-2 rounded-full bg-secondary p-1">
              <TabsTrigger value="login" className="rounded-full data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
                ログイン
              </TabsTrigger>
              <TabsTrigger value="signup" className="rounded-full data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
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
