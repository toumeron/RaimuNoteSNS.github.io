import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, StarOff } from 'lucide-react';
import { toast } from 'sonner';
import { isPostHighlighted, postHighlightKey, profileHighlightsKey, setPostHighlighted } from '@/api/profile-highlights';

export function HighlightPostMenuButton({ userId, postId, onClose }: { userId: string; postId: string; onClose: () => void }) {
  const client = useQueryClient();
  const highlight = useQuery({ queryKey: postHighlightKey(userId, postId), queryFn: () => isPostHighlighted(userId, postId) });
  const highlighted = highlight.data === true;
  const mutation = useMutation({
    mutationFn: () => setPostHighlighted(userId, postId, !highlighted),
    onSuccess: () => {
      client.setQueryData(postHighlightKey(userId, postId), !highlighted);
      void client.invalidateQueries({ queryKey: profileHighlightsKey(userId) });
      onClose();
      toast.success(highlighted ? 'ハイライトからポストを解除しました' : 'ハイライトにポストを追加しました');
    },
    onError: () => toast.error('ハイライトを変更できませんでした'),
  });

  return <button type="button" disabled={highlight.isPending || highlight.isError || mutation.isPending}
    onClick={event => { event.preventDefault(); event.stopPropagation(); mutation.mutate(); }}
    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50">
    {highlighted ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
    {highlighted ? 'ハイライトから解除' : 'ハイライトに追加'}
  </button>;
}
