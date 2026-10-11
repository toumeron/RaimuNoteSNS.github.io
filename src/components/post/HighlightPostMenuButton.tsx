import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, StarOff, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { isPostHighlighted, postHighlightKey, profileHighlightsKey, setPostHighlighted, getProfilePin, setProfilePin, profilePinKey } from "@/api/profile-highlights";

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

export function PinPostMenuButton({userId,postId,onClose}:{userId:string;postId:string;onClose:()=>void}){
  const client=useQueryClient();
  const pin=useQuery({queryKey:profilePinKey(userId),queryFn:()=>getProfilePin(userId)});
  const pinned=pin.data===postId;
  const mutation=useMutation({mutationFn:()=>setProfilePin(userId,pinned?null:postId),onSuccess:()=>{client.setQueryData(profilePinKey(userId),pinned?null:postId);onClose();toast.success(pinned?'ポストの固定を解除しました':'プロフィールにポストを固定しました');},onError:()=>toast.error('ポストの固定を変更できませんでした')});
  return <button type="button" disabled={pin.isPending||pin.isError||mutation.isPending} onClick={event=>{event.preventDefault();event.stopPropagation();mutation.mutate();}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50">{pinned?<PinOff className="h-4 w-4"/>:<Pin className="h-4 w-4"/>}{pinned?'プロフィールから固定を解除':'プロフィールに固定'}</button>;
}
