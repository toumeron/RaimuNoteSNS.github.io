import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useCreatePost } from '@/hooks/useFeed';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const MAX_LEN = 500;
const MAX_IMAGES = 4;

export function PostComposer() {
  const { user } = useAuth();
  const { mutateAsync, isPending } = useCreatePost();
  const [content, setContent] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const slots = MAX_IMAGES - previews.length;
    if (slots <= 0) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
      return;
    }
    const next = files.slice(0, slots).map((f) => URL.createObjectURL(f));
    setPreviews((p) => [...p, ...next]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removePreview = (i: number) => {
    setPreviews((p) => {
      URL.revokeObjectURL(p[i]);
      return p.filter((_, idx) => idx !== i);
    });
  };

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('本文を入力してください');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      toast.error(`本文は${MAX_LEN}文字以内で入力してください`);
      return;
    }
    try {
      // TODO: Supabase Storage に画像アップロード後、公開URLを imageUrls に渡す
      await mutateAsync({ content: trimmed, imageUrls: previews });
      setContent('');
      previews.forEach(URL.revokeObjectURL);
      setPreviews([]);
    } catch {
      /* toast は hook 側 */
    }
  };

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
      <div className="flex gap-3">
        <Avatar className="h-11 w-11 border-2 border-primary/30">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="いまどうしてる？"
            rows={3}
            className="resize-none border-0 bg-transparent px-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
          />

          {previews.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {previews.map((src, i) => (
                <div key={src} className="relative overflow-hidden rounded-2xl border border-border/60">
                  <img src={src} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePreview(i)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"
                    aria-label="画像を削除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={onFile}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 rounded-full text-accent hover:bg-accent-soft hover:text-accent"
                onClick={() => fileRef.current?.click()}
                disabled={previews.length >= MAX_IMAGES}
              >
                <ImagePlus className="mr-1.5 h-4 w-4" />
                画像
              </Button>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  overLimit ? 'font-bold text-destructive' : 'text-muted-foreground',
                )}
              >
                {remaining}
              </span>
            </div>
            <Button
              type="button"
              onClick={submit}
              disabled={isPending || overLimit || !content.trim()}
              className="rounded-full bg-gradient-primary px-5 font-bold shadow-soft transition hover:shadow-pop"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-1.5 h-4 w-4" />
                  ポスト
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
