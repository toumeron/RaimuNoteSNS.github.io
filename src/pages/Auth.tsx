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
    // ブラウザの自動再生ブロックを回避するハンドラー
    const handleUserInteraction = () => {
      if (audioRef.current) {
        audioRef.current.play().catch((err) => {
          console.log("Audio play blocked or failed:", err);
        });
        // 1度再生が試みられたらイベントリスナーを解除
        document.removeEventListener('click', handleUserInteraction);
        document.removeEventListener('keydown', handleUserInteraction);
      }
    };

    // ユーザーのアクションを監視
    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
    };
  }, []);

return (
  // 全体の背景を「常に真っ黒（bg-black）」に変更します
  <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 bg-black text-foreground transition-colors duration-200">
    
    {/* 背景動画（opacityで暗さを調整。数値が小さいほど暗い黒ベースになります） */}
    <video
      autoPlay
      loop
      muted
      playsInline
      className="absolute top-0 left-0 w-full h-full object-cover z-0 pointer-events-none opacity-60"
    >
      <source src="https://rr3---sn-oguelnsr.googlevideo.com/videoplayback?expire=1779342395&ei=20cOaqDdE_LM0u8Pt4j02AM&ip=216.40.74.11&id=o-AJlkl1v3UlVHBTrgal-KPEV1YoMJT4qOz52ibtLEBwKu&itag=136&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ==&cps=53&bui=AbKmrwrcPRFi37dPr7H5iV5BvvQS6HcSx6UDCim-3zubYRgLNcK7Et-Kqw8uQ0zGi3gLgfMAjEvnisau&spc=96Xrv-8rFzXDvkqvkZ9_2ehjz_fylt9Wd0_PK4A5-sjX&vprv=1&svpuc=1&mime=video/mp4&rqh=1&gir=yes&clen=97698519&dur=370.866&lmt=1677381585476448&keepalive=yes&fexp=51565116,51565682&c=ANDROID_VR&txp=6219224&sparams=expire,ei,ip,id,itag,source,requiressl,xpc,bui,spc,vprv,svpuc,mime,rqh,gir,clen,dur,lmt&sig=AHEqNM4wRQIhAPEbvG3Y8f6YCp_UPFjxjG2eckI1bP7M9yBT2Ht8aeXuAiBrdHx2JGL3w5AKanLQfVQamMOTBl5Vt8-ZnIDANGmSmw==&title=%E3%80%90%E3%83%9B%E3%83%BC%E3%83%A0%E3%83%89%E3%82%A2%E6%9C%AA%E8%A8%AD%E7%BD%AE%E3%81%AE%E3%82%BF%E3%83%BC%E3%83%9F%E3%83%8A%E3%83%AB%E9%A7%85%E3%80%91%E4%BC%91%E6%97%A5%E5%A4%9C%E3%81%AE%E5%B1%B1%E6%89%8B%E7%B7%9A%E6%96%B0%E5%AE%BF%E9%A7%85%E7%99%BA%E7%9D%80%E6%98%A0%E5%83%8F%E3%80%80E235%E7%B3%BB&rm=sn-gxuo03g-3c2s7s,sn-ixhz7s&rrc=79,104,191&req_id=6ef35e62f547a3ee&rms=rdu,au&ipbypass=yes&redirect_counter=3&cm2rm=sn-3pmsr7s&cms_redirect=yes&cmsv=e&met=1779320806,&mh=-9&mip=126.140.57.247&mm=34&mn=sn-oguelnsr&ms=ltu&mt=1779320683&mv=m&mvi=3&pl=16&lsparams=cps,ipbypass,met,mh,mip,mm,mn,ms,mv,mvi,pl,rms&lsig=APaTxxMwRAIgDORrJPGIOcxFCxQC5LP4oSW-PBE1T4zylpPPrqBPXVQCICgAbU41nrkigvEwIroZXKPTMMwbCdVT3o-mga9A8yFo" type="video/mp4" />
    </video>

    {/* （オプショナル）もし動画の色味をさらに微調整したい場合は、ここに黒い遮光レイヤーを挟むことも可能です */}
    {/* <div className="absolute top-0 left-0 w-full h-full bg-black/50 z-1 pointer-events-none" /> */}

      {/* 2. 効果音・BGM用の音声（MP3） */}
      <audio
        ref={audioRef}
        src="/background-music.mp3"
        loop
        preload="auto"
      />

      {/* コンテンツエリア（動画の上に重ねるために z-10 を指定） */}
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