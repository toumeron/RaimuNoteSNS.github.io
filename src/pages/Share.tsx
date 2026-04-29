import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PostComposer } from '../components/feed/PostComposer';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Share2 } from 'lucide-react';

/**
 * PWAのWeb Share Targetからのデータを受け取る専用ページ
 * vite.config.ts で設定した action: "/RaimuNoteSNS.github.io/share" に対応
 */
export default function Share() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [initialContent, setInitialContent] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // 共有メニューから送られてくるパラメータを取得
    const title = searchParams.get('title') || '';
    const text = searchParams.get('text') || '';
    const url = searchParams.get('url') || '';

    // これらを組み合わせて投稿の初期テキストを作成
    // 例: 「タイトル」本文 URL
    const parts = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (url) parts.push(url);

    const combined = parts.join('\n');
    setInitialContent(combined);
    setIsReady(true);
  }, [searchParams]);

  const handleSuccess = () => {
    // 投稿が完了したらタイムラインへ遷移
    navigate('/', { replace: true });
  };

  if (!isReady) return null;

  return (
    <div className="container max-w-2xl py-6 space-y-6">
      {/* ヘッダー部分 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/')} 
            className="rounded-full hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-black flex items-center gap-2">
              <Share2 className="h-5 w-5 text-accent" />
              シェアしてポスト
            </h1>
            <p className="text-xs text-muted-foreground">
              外部アプリから共有された内容を編集して投稿できます
            </p>
          </div>
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* 既存のPostComposerを呼び出し */}
        {/* initialContentをPropsとして受け取れるようにPostComposer.tsxの修正が必要です */}
        <PostComposer 
          initialContent={initialContent} 
          onSuccess={handleSuccess} 
        />
      </div>

      <div className="text-center">
        <Button 
          variant="link" 
          className="text-muted-foreground text-sm"
          onClick={() => navigate('/')}
        >
          キャンセルしてタイムラインに戻る
        </Button>
      </div>
    </div>
  );
}