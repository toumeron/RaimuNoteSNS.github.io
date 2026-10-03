begin;

-- following means the author follows the viewer, never the reverse.
-- SECURITY DEFINER prevents unrelated follows/memberships RLS from hiding the
-- relationship needed to enforce the post's audience.
create function public.can_view_post_audience(post_author uuid, post_visibility text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(post_visibility, 'public') = 'public'
    or post_author = auth.uid()
    or (post_visibility = 'following' and exists (
      select 1 from public.follows f
      where f.follower_id = post_author and f.followee_id = auth.uid()
    ))
    or (post_visibility = 'members' and exists (
      select 1 from public.memberships m
      where m.creator_id = post_author and m.member_id = auth.uid()
    ));
$$;
revoke all on function public.can_view_post_audience(uuid, text) from public;
grant execute on function public.can_view_post_audience(uuid, text) to anon, authenticated;

-- A restrictive policy is ANDed with the legacy permissive policies, including
-- debug ALL policies. It also applies to parent_post embeds and direct URLs.
create policy posts_enforce_audience on public.posts as restrictive
for select to anon, authenticated
using (public.can_view_post_audience(user_id, visibility));

create policy comments_enforce_post_audience on public.comments as restrictive
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id));

notify pgrst, 'reload schema';
commit;
