import { supabase } from '@/lib/supabase';
export type AccountReview = {
  id: string; author_id: string; rating: number; title: string; content: string; created_at: string;
  likes_count: number; liked_by_me: boolean;
  author: { username: string; display_name: string; avatar_url: string; is_official: boolean; is_private?: boolean };
};
export type AccountReviews = {
  enabled: boolean; total: number; average: number; distribution: Record<string, number>; reviews: AccountReview[];
};
export const accountReviewsKey = (profileId: string) => ['account-reviews', profileId] as const;
export async function getAccountReviews(profileId: string, offset = 0): Promise<AccountReviews> {
  const { data, error } = await supabase.rpc('get_account_reviews', { target_profile: profileId, page_offset: offset });
  if (error) throw error;
  return data as AccountReviews;
}
export async function submitAccountReview(profileId: string, rating: number, title: string, content: string) {
  const { error } = await supabase.rpc('submit_account_review', {
    target_profile: profileId, stars: rating, review_title: title, review_content: content,
  });
  if (error) throw error;
}
export async function setAccountReviewLike(reviewId: string, enabled: boolean): Promise<{liked: boolean; count: number}> {
  const { data, error } = await supabase.rpc('set_account_review_like', { target_review: reviewId, enabled });
  if (error) throw error;
  return data;
}
