import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Minus, Activity, Cpu, Gauge, ShieldCheck, ArrowUpRight, ChevronDown, Monitor, Zap, Loader2 } from "lucide-react";
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function LimeProLanding() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  useEffect(() => {
    document.title = "LIMEPRO | MISSION TO ADVANCE AI";
    window.scrollTo(0, 0);
  }, []);

  // 決済（有効化）と通信処理の実装
  const handleSubscribe = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isPurchasing) return;
    
    if (!authUser?.id) {
      toast.error('ログインが必要です');
      navigate('/auth');
      return;
    }

    setIsPurchasing(true);

    try {
      // 1. データベース (Supabase) への登録処理
      const { error } = await supabase
        .from('user_entitlements')
        .insert({
          user_id: authUser.id,
          feature: 'limepro',
        });

      if (error) {
        // すでに登録済みの場合 (PostgreSQLのユニーク制約エラー)
        if (error.code === '23505') {
          toast.info('すでにLimeProが有効です');
          // すでに有効な場合でも完了画面は見せる
        } else {
          throw error;
        }
      } else {
        toast.success('LimeProを有効化しました');
      }

      // 2. アプリ全体のステータス同期 (Settings.tsxと同等の処理)
      const nextStatus = true;
      localStorage.setItem('limepro_status', String(nextStatus));

      window.dispatchEvent(
        new CustomEvent('limepro-status-changed', {
          detail: { hasLimePro: nextStatus },
        })
      );

      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('limepro-status');
        channel.postMessage({ hasLimePro: nextStatus });
        channel.close();
      }

      // 3. 完了オーバーレイの表示
      setShowSuccessOverlay(true);

    } catch (error: any) {
      console.error("Subscription failed:", error);
      toast.error('LimeProの有効化に失敗しました');
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap');
          
          :root {
            --spacex-font: 'Noto Sans JP', sans-serif;
          }

          .spacex-font {
            font-family: var(--spacex-font) !important;
          }

          .heavy-title {
            font-weight: 900 !important;
            letter-spacing: -0.04em !important;
            line-height: 0.85 !important;
            text-transform: uppercase;
          }

          .technical-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.4em;
            text-transform: uppercase;
            color: #71717a;
          }

          .blueprint-grid {
            background-size: 50px 50px;
            background-image: 
              linear-gradient(to right, currentColor 1px, transparent 1px),
              linear-gradient(to bottom, currentColor 1px, transparent 1px);
          }

          html {
            scroll-behavior: smooth;
          }
        `
      }} />

      <div className="spacex-font w-full min-h-screen bg-white text-black dark:bg-black dark:text-white transition-colors duration-700 overflow-x-hidden selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black">
        
        <div className="fixed inset-0 z-0 pointer-events-none blueprint-grid opacity-[0.03] dark:opacity-[0.07]" />
        
        <main className="relative z-10">
          <HeroSection onSubscribe={handleSubscribe} isPurchasing={isPurchasing} />
          <MissionStats />
          <TechnicalSpecs />
          <TelemetryOverview />
          <ComparisonGrid />
          <LaunchSequence />
          <FinalCta onSubscribe={handleSubscribe} isPurchasing={isPurchasing} />
          <GlobalFooter />
        </main>
      </div>

      {/* 決済完了時のフルスクリーンオーバーレイ */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/90 dark:bg-black/90 backdrop-blur-md animate-in fade-in duration-500">
          <div className="absolute inset-0 pointer-events-none blueprint-grid opacity-10 dark:opacity-20 text-black dark:text-white" />
          
          <div className="relative z-10 w-full max-w-lg p-12 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black flex flex-col items-center text-center shadow-2xl">
            <div className="w-16 h-16 mb-8 border-2 border-black dark:border-white flex items-center justify-center animate-in zoom-in duration-500 delay-200">
              <Check className="w-8 h-8 text-black dark:text-white" strokeWidth={3} />
            </div>
            
            <div className="technical-label mb-4">決済ID:UWSHUIQD4328SUHI</div>
            <h2 className="text-3xl font-black uppercase tracking-widest mb-6">決済が完了しました</h2>
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 leading-relaxed mb-12">
              決済が正常に完了しました。<br />
              全プレミアム機能へのアクセスができるようになりました
            </p>
            
            <button
              onClick={() => navigate('/')}
              className="group relative inline-flex w-full items-center justify-center px-12 py-5 bg-black dark:bg-white text-white dark:text-black overflow-hidden"
            >
              <span className="absolute inset-0 bg-zinc-800 dark:bg-zinc-200 scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100" />
              <span className="relative z-10 text-xs font-bold tracking-[0.3em] uppercase flex items-center gap-2">
                ホームに戻る <ArrowUpRight className="w-4 h-4" />
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ==========================================
// 1. HERO
// ==========================================
function HeroSection({ onSubscribe, isPurchasing }: { onSubscribe: (e: React.MouseEvent) => void, isPurchasing: boolean }) {
  return (
    <section className="relative w-full h-screen min-h-[800px] flex flex-col justify-end pb-24 md:pb-32 px-6 md:px-12 lg:px-24 max-w-[1600px] mx-auto overflow-hidden">
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-zinc-100/50 dark:from-zinc-900/30 to-transparent -z-10" />

      <div className="max-w-5xl animate-in fade-in slide-in-from-bottom-12 duration-1000">
        <div className="technical-label mb-8 flex items-center gap-4">
          <span className="w-8 h-[1px] bg-black dark:bg-white" />
          LimeNote Premium Membership
        </div>
        
        <h1 className="heavy-title text-7xl md:text-[10rem] lg:text-[13rem] mb-10">
          LimePro
        </h1>

        <div className="grid md:grid-cols-2 gap-12 items-end">
          <p className="text-base md:text-xl leading-relaxed text-zinc-600 dark:text-zinc-400 font-medium tracking-wide">
            AIの限界を、今すぐ突破する。最先端の演算能力を、
            すべての人に。月額わずか <span className="text-black dark:text-white font-bold">¥1</span> で開始
          </p>
          
          <div className="flex flex-col gap-6">
            <button
              onClick={onSubscribe}
              disabled={isPurchasing}
              className="group relative inline-flex items-center justify-center px-16 py-6 border-2 border-black dark:border-white overflow-hidden bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="absolute inset-0 w-full h-full bg-black dark:bg-white scale-y-0 origin-bottom transition-transform duration-500 ease-out group-hover:scale-y-100" />
              <span className="relative z-10 text-xs font-bold tracking-[0.2em] uppercase text-black dark:text-white group-hover:text-white dark:group-hover:text-black transition-colors duration-500 flex items-center gap-2">
                {isPurchasing ? <><Loader2 className="w-4 h-4 animate-spin" /> PROCESSING...</> : "Subscribe Now — ¥1"}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce opacity-30">
        <ChevronDown size={32} />
      </div>
    </section>
  );
}

// ==========================================
// 2. MISSION STATS
// ==========================================
function MissionStats() {
  const stats = [
    { label: "Price per Month", value: "¥1", unit: "TAX INC" },
    { label: "AI Model", value: "LATEST", unit: "V.4.0" },
    { label: "Chat Capacity", value: "UNLTD", unit: "TOKENS" },
    { label: "Priority", value: "HIGH", unit: "SERVER" },
  ];

  return (
    <section className="w-full py-20 border-y border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 grid grid-cols-2 lg:grid-cols-4 gap-12">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col">
            <div className="technical-label mb-2">{stat.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl md:text-6xl font-black">{stat.value}</span>
              <span className="text-[10px] font-bold text-zinc-400">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ==========================================
// 3. TECHNICAL SPECS
// ==========================================
function TechnicalSpecs() {
  const specs = [
    { id: "SYS-01", icon: Cpu, title: "演算コアのアップグレード", desc: "最新のAIアーキテクチャへの優先アクセス。より深い推論と正確な出力。" },
    { id: "SYS-02", icon: Zap, title: "低遅延レスポンス", desc: "混雑時も待機列をバイパス。ミリ秒単位の応答速度を保証。" },
    { id: "SYS-03", icon: Monitor, title: "コンテキスト拡張", desc: "長文の理解能力を最大化。数万文字に及ぶドキュメントも一瞬で分析。" },
    { id: "SYS-04", icon: ShieldCheck, title: "認証済みバッジ", desc: "プレミアムユーザーとしてのステータスを。コミュニティでの信頼を象徴。" },
  ];

  return (
    <section id="specs" className="w-full bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row border-l border-zinc-200 dark:border-zinc-800">
        <div className="md:w-1/3 p-12 md:p-24 border-b border-r border-zinc-200 dark:border-zinc-800 flex flex-col justify-between">
          <h2 className="heavy-title text-5xl md:text-7xl">CORE<br />SPECS</h2>
          <div className="technical-label mt-12">01 — capabilities</div>
        </div>
        <div className="md:w-2/3 grid grid-cols-1 md:grid-cols-2">
          {specs.map((spec) => (
            <div key={spec.id} className="p-12 border-b border-r border-zinc-200 dark:border-zinc-800 hover:bg-white dark:hover:bg-black transition-all duration-500 group">
              <div className="flex justify-between items-start mb-16">
                <spec.icon size={40} strokeWidth={1} className="text-zinc-400 group-hover:text-black dark:group-hover:text-white transition-colors" />
                <span className="text-[10px] font-mono text-zinc-400">{spec.id}</span>
              </div>
              <h3 className="text-2xl font-black uppercase mb-4 tracking-tight">{spec.title}</h3>
              <p className="text-zinc-500 dark:text-zinc-400 leading-loose text-sm font-medium">{spec.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ==========================================
// 4. TELEMETRY
// ==========================================
function TelemetryOverview() {
  return (
    <section className="w-full py-32 md:py-48 px-6 bg-white dark:bg-black">
      <div className="max-w-[1400px] mx-auto">
        <div className="grid lg:grid-cols-[1fr_auto_1fr] items-center gap-16 md:gap-24">
          <div className="flex flex-col gap-8">
            <h2 className="heavy-title text-5xl md:text-7xl">10X<br />SPEED.</h2>
            <p className="text-sm md:text-base text-zinc-500 leading-relaxed font-medium">
              ピークタイムにおける平均応答速度。最適化されたサーバーインスタンスが、あなたの思考を止めることなく出力を継続します。
            </p>
          </div>
          <div className="hidden lg:block w-[1px] h-64 bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex flex-col gap-8">
            <h2 className="heavy-title text-5xl md:text-7xl">DATA<br />FLOW.</h2>
            <p className="text-sm md:text-base text-zinc-500 leading-relaxed font-medium">
              転送量制限の完全排除。大規模なプロジェクト、プログラミング、執筆。どのような負荷でも安定したデータフローを提供。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ==========================================
// 5. COMPARISON
// ==========================================
function ComparisonGrid() {
  const data = [
    { label: "最新モデルへのアクセス", free: "LIMITED", pro: "FULL ACCESS" },
    { label: "1日のチャット枠", free: "10回", pro: "UNLIMITED" },
    { label: "優先演算処理", free: "STANDARD", pro: "HIGH PRIORITY" },
    { label: "画像解析能力", free: "NO", pro: "YES" },
    { label: "メンバーバッジ", free: "-", pro: "ACTIVE" },
    { label: "月額料金", free: "¥0", pro: "¥1" },
  ];

  return (
    <section id="compare" className="w-full py-32 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="technical-label mb-12 text-center">Comparative Parameters</div>
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
          <div className="grid grid-cols-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900">
            <div className="p-6 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Feature</div>
            <div className="p-6 text-[10px] font-bold uppercase tracking-widest text-zinc-500 text-center">Free</div>
            <div className="p-6 text-[10px] font-bold uppercase tracking-widest text-black dark:text-white text-center">Pro</div>
          </div>
          {data.map((row, i) => (
            <div key={row.label} className={`grid grid-cols-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${i !== data.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''}`}>
              <div className="p-6 text-sm font-bold tracking-tight uppercase">{row.label}</div>
              <div className="p-6 text-sm text-center text-zinc-400 font-medium">{row.free}</div>
              <div className="p-6 text-sm text-center font-black tracking-widest">{row.pro}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ==========================================
// 6. LAUNCH STEPS
// ==========================================
function LaunchSequence() {
  const steps = [
    { t: "T-03", title: "Authentication", desc: "お持ちのアカウントでログイン。プロフィールを同期します。" },
    { t: "T-02", title: "Configuration", desc: "決済方法を登録。¥1の取引が安全に承認されます。" },
    { t: "T-01", title: "Ignition", desc: "手続き完了。全Pro機能が即座にシステムに反映されます。" },
  ];

  return (
    <section className="w-full py-32 px-6 bg-white dark:bg-black">
      <div className="max-w-[1400px] mx-auto">
        <div className="technical-label mb-20 text-center">Launch Sequence</div>
        <div className="grid md:grid-cols-3 gap-1">
          {steps.map((step) => (
            <div key={step.t} className="p-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center text-center">
              <div className="text-4xl font-black mb-8 border-b-2 border-black dark:border-white pb-2">{step.t}</div>
              <h4 className="text-xl font-black mb-4 uppercase tracking-tighter">{step.title}</h4>
              <p className="text-sm text-zinc-500 font-medium leading-loose">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ==========================================
// 7. FINAL CTA
// ==========================================
function FinalCta({ onSubscribe, isPurchasing }: { onSubscribe: (e: React.MouseEvent) => void, isPurchasing: boolean }) {
  return (
    <section id="join" className="relative w-full py-56 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center overflow-hidden px-6">
      <div className="absolute inset-0 blueprint-grid opacity-[0.05] dark:opacity-[0.1]" />
      <div className="relative z-10 max-w-4xl">
        <h2 className="heavy-title text-6xl md:text-9xl mb-16">今すぐ登録</h2>
        <button
          onClick={onSubscribe}
          disabled={isPurchasing}
          className="group relative inline-flex items-center justify-center px-16 py-7 bg-black dark:bg-white text-white dark:text-black text-sm font-black tracking-[0.3em] uppercase overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="absolute inset-0 bg-zinc-700 dark:bg-zinc-300 scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100" />
          <span className="relative z-10 flex items-center gap-4">
            {isPurchasing ? <><Loader2 className="w-5 h-5 animate-spin" />関連する決済情報から決済中...</> : <>サブスクリプションを登録 <ArrowUpRight /></>}
          </span>
        </button>
        <p className="mt-12 text-[10px] font-bold text-zinc-400 tracking-[0.2em] uppercase">¥1 per month. cancel anytime.</p>
      </div>
    </section>
  );
}

// ==========================================
// 8. FOOTER
// ==========================================
function GlobalFooter() {
  return (
    <footer className="w-full py-16 px-6 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
      <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-start gap-12">
        <div className="flex flex-col gap-6">
          <div className="text-2xl font-black tracking-tighter">LIMEPRO</div>
          <div className="flex gap-8 text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
            <a href="#" className="hover:text-black dark:hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-black dark:hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-black dark:hover:text-white transition-colors">Contact</a>
          </div>
        </div>
        <div className="text-[9px] text-zinc-500 uppercase tracking-widest leading-loose max-w-md">
          © {new Date().getFullYear()} LimeNote Premium Membership. <br />
          All data processed via encrypted secure links. Specifications and pricing subject to orbital variations.
        </div>
      </div>
    </footer>
  );
}