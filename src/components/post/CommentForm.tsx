import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useCreateComment } from '@/hooks/useComments';
import { toast } from 'sonner';

const MAX = 280;

export function CommentForm({ postId }: { postId: string }) {
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
    } catch {/* hook側でtoast */}
  };

  return (
    <div className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-soft">
      <Avatar className="h-9 w-9 border border-primary/30">
        <AvatarImage src={user.avatarUrl} alt={user.displayName} />
        <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="コメントを書く…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        className="flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40"
      />
      <Button
        onClick={submit}
        disabled={isPending || !text.trim()}
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full bg-gradient-primary shadow-soft"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
