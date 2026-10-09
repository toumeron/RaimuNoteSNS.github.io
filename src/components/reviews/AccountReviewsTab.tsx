import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';
import { ReviewStars } from './ReviewStars';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { accountReviewsKey, getAccountReviews, setAccountReviewLike, submitAccountReview } from '@/api/account-reviews';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LikeButton } from '@/components/post/LikeButton';


export function AccountReviewsTab({ profileId }: { profileId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = accountReviewsKey(profileId);
  const query = useInfiniteQuery({ queryKey: [...key, user?.id], initialPageParam: 0,
    queryFn: ({ pageParam }) => getAccountReviews(profileId, pageParam),
    getNextPageParam: (last, pages) => pages.reduce((n,p)=>n+p.reviews.length,0)<last.total
      && last.reviews.length ? pages.reduce((n,p)=>n+p.reviews.length,0) : undefined,
  });
  const summary = query.data?.pages[0];
  const reviews = query.data?.pages.flatMap(page => page.reviews) ?? [];
  const ownReview = reviews.find(review => review.author_id === user?.id);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const mutation = useMutation({ mutationFn: () => submitAccountReview(profileId, rating, title, content),
    onSuccess: async () => { await queryClient.invalidateQueries({queryKey:key}); setOpen(false); toast.success('レビューを保存しました'); },
    onError: () => toast.error('レビューを保存できませんでした。もう一度お試しください。'),
  });
  const startReview = () => {
    if (!user) { toast.error('レビューの投稿にはログインが必要です'); return; }
    setRating(ownReview?.rating ?? 0); setTitle(ownReview?.title ?? ''); setContent(ownReview?.content ?? ''); setOpen(true);
  };
  if (query.isPending) return <p className="p-6 text-muted-foreground" role="status">レビューを読み込み中...</p>;
  if (query.isError) return <div className="p-6"><p role="alert">レビューの取得に失敗しました。</p><Button variant="outline" onClick={()=>query.refetch()}>再試行</Button></div>;
  if (!summary?.enabled) return <p className="p-6 text-muted-foreground">このアカウントのレビューは現在利用できません。</p>;
  return <section data-lime-account-reviews className="relative left-1/2 w-screen min-w-0 -translate-x-1/2 px-4 py-6 sm:left-auto sm:w-auto sm:translate-x-0 sm:px-6">
    <div className="flex flex-wrap items-center gap-3"><ReviewStars value={summary.average}/><span className="text-lg">5つのうち{summary.average.toFixed(1)}つ</span></div>
    <p className="mt-2 text-sm text-muted-foreground">{summary.total.toLocaleString()}件の評価</p>
    <div className="my-6 space-y-3" aria-label="星ごとの評価の割合">
      {[5,4,3,2,1].map(star=>{
        const percentage = summary.total ? Math.round((summary.distribution[String(star)]??0)/summary.total*100) : 0;
        return <div key={star} className="flex items-center gap-4 text-sm">
          <span className="w-10 shrink-0">星{star}つ</span>
          <div role="meter" aria-label={`星${star}つの割合`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="h-6 flex-1 overflow-hidden rounded-md border border-border bg-muted/30"><div className="h-full bg-orange-500" style={{width:`${percentage}%`}} /></div>
          <span className="w-10 shrink-0 text-right">{percentage}%</span>
        </div>;
      })}
    </div>
    <div data-lime-review-compose className="-mx-4 border-b border-border px-4 py-6 sm:-mx-6 sm:px-6">
      <Button variant="outline" className="w-full rounded-full hover:bg-background hover:text-foreground active:bg-background focus:bg-background focus-visible:ring-border" onClick={startReview}>{ownReview ? 'レビューを編集' : 'レビューを書く'}</Button>
    </div>
    {reviews.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">まだレビューがありません。</p>}
    <div>{reviews.map(review=><article key={review.id} data-lime-account-review className="-mx-4 border-b border-border px-4 py-6 sm:-mx-6 sm:px-6">
      <Link to={`/u/${review.author.username}`} className="inline-flex max-w-full items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={review.author.avatar_url || undefined}/><AvatarFallback>{(review.author.display_name||review.author.username).slice(0,1)}</AvatarFallback></Avatar>
        <span className="flex min-w-0 items-center gap-1">
          <span data-lime-review-author-name className="min-w-0 truncate font-semibold leading-tight">{review.author.display_name || review.author.username}</span>
          {review.author.is_private && <PrivateAccountBadge/>}{review.author.is_official && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[1.1em] w-[1.1em] shrink-0 translate-y-[1px]"/>}
        </span>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2"><ReviewStars value={review.rating}/>{review.title && <h3 className="min-w-0 break-words font-bold">{review.title}</h3>}</div>
      <p className="mt-1 text-sm text-muted-foreground">{new Date(review.created_at).toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'})}にレビュー</p>
      <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{review.content}</p>
      <div className="mt-3"><LikeButton postId={review.id} liked={review.liked_by_me} count={review.likes_count} syncState
        persistLike={async liked=>{
          try { return await setAccountReviewLike(review.id,liked); }
          catch(error) { toast.error(user ? 'いいねを保存できませんでした' : 'いいねにはログインが必要です'); throw error; }
        }} onChange={()=>{void queryClient.invalidateQueries({queryKey:key});}}/></div>
    </article>)}</div>
    {query.hasNextPage && <Button variant="outline" className="mt-4 w-full" disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>さらに読み込む</Button>}
    {query.isFetchNextPageError && <p role="alert" className="mt-2 text-sm text-destructive">追加のレビューを取得できませんでした。再度読み込んでください。</p>}
    <Dialog open={open} onOpenChange={value=>{if(!mutation.isPending)setOpen(value);}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto max-sm:inset-0 max-sm:z-[2147483200] max-sm:flex max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:rounded-none max-sm:border-0 max-sm:pt-[calc(1.5rem+env(safe-area-inset-top))] max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:shadow-none max-sm:data-[state=open]:animate-none max-sm:data-[state=closed]:animate-none max-sm:[&>button]:top-[calc(1rem+env(safe-area-inset-top))]"><DialogHeader><DialogTitle>{ownReview ? 'レビューを編集' : 'レビューを書く'}</DialogTitle><DialogDescription>星評価と感想を入力してください。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event=>{event.preventDefault(); if(rating && content.trim())mutation.mutate();}}>
          <fieldset><legend className="mb-2 text-sm font-medium">星評価（必須）</legend><div className="flex gap-2">
            {[1,2,3,4,5].map(star=><label key={star} className="relative cursor-pointer rounded-md p-1 focus-within:ring-2 focus-within:ring-ring">
              <input type="radio" name="rating" value={star} checked={rating===star} onChange={()=>setRating(star)} aria-label={`星${star}つ`} required className="sr-only"/>
              <Star className={`h-8 w-8 ${star<=rating?'fill-orange-500 text-orange-500':'text-muted-foreground'}`}/>
            </label>)}
          </div></fieldset>
          <label className="block text-sm font-medium" htmlFor="review-title">タイトル（任意）</label><Input id="review-title" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/>
          <label className="block text-sm font-medium" htmlFor="review-content">レビュー（必須）</label><Textarea id="review-content" required maxLength={2000} rows={5} value={content} onChange={e=>setContent(e.target.value)}/>
          <p className="text-right text-xs text-muted-foreground">{content.length}/2000</p>
          <Button type="submit" className="w-full" disabled={mutation.isPending||!rating||!content.trim()}>{mutation.isPending?'保存中...':'レビューを保存'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
