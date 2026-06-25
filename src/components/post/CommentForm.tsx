import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useCreateComment } from '@/hooks/useComments';
import { toast } from 'sonner';

const MAX = 280;

type CommentFormVariant = 'default' | 'mobileDock' | 'bottomNav';

export function CommentForm({
  postId,
  variant = 'default',
}: {
  postId: string;
  variant?: CommentFormVariant;
}) {
  const { user } = useAuth();
  const { mutateAsync, isPending } = useCreateComment(postId);
  const [text, setText] = useState('');

  if (!user) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    if (t.length > MAX) {
      toast.error(`コメントは${MAX}文字以内で入力してください`);
      return;
    }
    try {
      await mutateAsync(t);
      setText('');
    } catch {
      /* hook側でtoast */
    }
  };

  const isMobileDock = variant === 'mobileDock';
  const isBottomNav = variant === 'bottomNav';
  return (
    <>
      <style>{`
        @media (max-width: 639px) {
          .comment-form-mobile-dock {
            position: fixed;
            left: 0;
            right: 0;
            bottom: calc(var(--lime-bottom-nav-height, 58px));
            z-index: 120;
            display: grid !important;
            grid-template-columns: 40px minmax(0, 1fr) 38px;
            align-items: center;
            gap: 9px;
            min-height: 58px;
            padding: 8px 12px;
            border: 0 !important;
            border-top: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: hsl(var(--background)) !important;
            box-shadow: none !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
          }

          .comment-form-bottom-nav {
            display: grid !important;
            grid-template-columns: 38px minmax(0, 1fr) 36px;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-height: 46px;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
          }

          .comment-form-mobile-dock-avatar,
          .comment-form-bottom-nav-avatar {
            width: 36px !important;
            height: 36px !important;
            border-color: hsl(var(--border) / 0.62) !important;
          }

          .comment-form-mobile-dock-input,
          .comment-form-bottom-nav-input {
            height: 40px !important;
            min-width: 0 !important;
            border: 0 !important;
            border-radius: 9999px !important;
            background: hsl(var(--muted) / 0.72) !important;
            color: hsl(var(--foreground)) !important;
            caret-color: hsl(var(--primary)) !important;
            padding-left: 16px !important;
            padding-right: 16px !important;
            font-size: 16px !important;
            font-weight: 500 !important;
            box-shadow: none !important;
          }

          .comment-form-mobile-dock-input::placeholder,
          .comment-form-bottom-nav-input::placeholder {
            color: hsl(var(--muted-foreground)) !important;
            opacity: 1 !important;
          }

          .comment-form-mobile-dock-input:focus-visible,
          .comment-form-bottom-nav-input:focus-visible {
            --tw-ring-color: hsl(var(--primary) / 0.55) !important;
            --tw-ring-offset-color: transparent !important;
            outline: none !important;
            box-shadow: 0 0 0 1px hsl(var(--primary) / 0.55) !important;
          }

          .comment-form-mobile-dock-submit,
          .comment-form-bottom-nav-submit {
            width: 36px !important;
            height: 36px !important;
            border-radius: 9999px !important;
            background: hsl(var(--primary)) !important;
            color: white !important;
            box-shadow: none !important;
          }

          .comment-form-mobile-dock-submit:disabled,
          .comment-form-bottom-nav-submit:disabled {
            opacity: 0.42 !important;
          }
        }
      `}</style>

      <div
        className={`flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-soft ${
          isMobileDock ? 'comment-form-mobile-dock' : ''
        } ${isBottomNav ? 'comment-form-bottom-nav' : ''}`}
      >
        <Avatar
          className={`h-9 w-9 border border-primary/30 ${
            isMobileDock ? 'comment-form-mobile-dock-avatar' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-avatar' : ''}`}
        >
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="返信をポスト"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          className={`flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMobileDock ? 'comment-form-mobile-dock-input' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-input' : ''}`}
        />
        <Button
          onClick={submit}
          disabled={isPending || !text.trim()}
          size="icon"
          className={`h-9 w-9 shrink-0 rounded-full bg-gradient-primary shadow-soft ${
            isMobileDock ? 'comment-form-mobile-dock-submit' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-submit' : ''}`}
          aria-label="コメントを送信"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
