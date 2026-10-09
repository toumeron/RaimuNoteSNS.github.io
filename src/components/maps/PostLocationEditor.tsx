import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { setPostMapLocation } from '@/api/posts';
import type { PostWithAuthor } from '@/types';
import type { MapLocation } from '@/lib/mapLocation';
import LimeMap from './LimeMap';
import { toast } from 'sonner';
export default function PostLocationEditor({ post, onClose }: {
    post: PostWithAuthor;
    onClose: () => void;
}) {
    const [point, setPoint] = useState<MapLocation | null>(post.mapLocation ?? null);
    const qc = useQueryClient();
    const save = useMutation({ mutationFn: (location: MapLocation | null) => setPostMapLocation(post.id, location), onSuccess: () => { qc.invalidateQueries({ queryKey: ['map-posts'] }); qc.invalidateQueries({ queryKey: ['posts'] }); qc.invalidateQueries({ queryKey: ['post', post.id] }); qc.invalidateQueries({ queryKey: ['feed'] }); toast.success('ポストの場所を更新しました'); onClose(); }, onError: () => toast.error('場所を保存できませんでした') });
    return <Dialog open onOpenChange={open => { if (!open && !save.isPending)
        onClose(); }}><DialogContent className="lime-map-dialog flex max-h-[90dvh] flex-col gap-3 p-4 sm:max-w-2xl" aria-describedby={undefined} onInteractOutside={e => e.preventDefault()}>
  <DialogTitle className="pr-8">ポストを編集</DialogTitle><p className="text-sm text-muted-foreground">地図を押して場所を選択してください。</p>
  <div className="lime-map-dialog-body"><LimeMap initialLocation={post.mapLocation} onSelect={setPoint}/></div>
  <div className="flex justify-between gap-3"><Button variant="ghost" disabled={!post.mapLocation || save.isPending} onClick={() => save.mutate(null)}>場所を削除</Button><Button disabled={!point || save.isPending} onClick={() => save.mutate(point)}>保存する</Button></div>
 </DialogContent></Dialog>;
}
