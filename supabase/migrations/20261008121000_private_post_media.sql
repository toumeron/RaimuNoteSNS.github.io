begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('post-media','post-media',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','image/avif']);

-- Every read is checked against CURRENT post visibility, including unfollows.
-- Bucket isolation is restrictive so broad existing Storage policies cannot
-- grant access. Never issue signed URLs to this bucket from the client.
create policy security_post_media_read on storage.objects as restrictive for select to anon,authenticated using (
 bucket_id<>'post-media' or (
  (storage.foldername(name))[1]=auth.uid()::text
  or exists(select 1 from public.posts p where ('storage://post-media/'||name)=any(p.image_urls))
  or exists(select 1 from public.comments c where ('storage://post-media/'||name)=any(c.image_urls))
 ));
create policy post_media_read on storage.objects for select to anon,authenticated using(bucket_id='post-media');
create policy security_post_media_insert on storage.objects as restrictive for insert to anon,authenticated with check(
 bucket_id<>'post-media' or ((storage.foldername(name))[1]=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'));
create policy post_media_insert on storage.objects for insert to authenticated with check(bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy security_post_media_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'post-media') with check(bucket_id<>'post-media');
create policy security_post_media_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'post-media' or (storage.foldername(name))[1]=auth.uid()::text);
create policy post_media_delete on storage.objects for delete to authenticated using(bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Reject attacker-owned/cross-account references even in direct REST writes.
-- Existing legacy images need a separate migration and provider deletion.
create function limenote_security.validate_post_media() returns trigger language plpgsql set search_path='' as $$
declare image text; restricted boolean; changed boolean;
begin
 if tg_table_name='posts' then restricted:=coalesce(new.visibility,'public')<>'public';
 else select coalesce(p.visibility,'public')<>'public' into restricted from public.posts p where p.id=new.post_id; end if;
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then
  changed:=new.image_urls is distinct from old.image_urls;
  if tg_table_name='posts' then changed:=changed or new.visibility is distinct from old.visibility; end if;
 end if;
 if not changed then return new; end if;
 foreach image in array coalesce(new.image_urls,array[]::text[]) loop
  if image like 'storage://post-media/%' then
   if split_part(image,'/',4)<>new.user_id::text or image !~ '^storage://post-media/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$' then
    raise exception 'Invalid media ownership' using errcode='42501';
   end if;
  elsif restricted then
   raise exception 'Restricted attachments must use private storage' using errcode='42501';
  elsif image !~ '^https?://' then
   raise exception 'Invalid image reference' using errcode='22023';
  end if;
 end loop;
 return new;
end;$$;
revoke all on function limenote_security.validate_post_media() from public,anon,authenticated;
create trigger security_post_media before insert or update on public.posts for each row execute function limenote_security.validate_post_media();
create trigger security_comment_media before insert or update on public.comments for each row execute function limenote_security.validate_post_media();

-- A service-only compare-and-swap for the separate legacy-image migration.
-- Do not overwrite edits or copy attachments of a now-public/deleted post.
create function public.replace_legacy_private_media(p_kind text,p_id uuid,p_original text[],p_replacement text[])
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if p_kind='posts' then
  update public.posts set image_urls=p_replacement where id=p_id and image_urls=p_original and coalesce(visibility,'public')<>'public';
 elsif p_kind='comments' then
  update public.comments c set image_urls=p_replacement where c.id=p_id and c.image_urls=p_original
   and exists(select 1 from public.posts p where p.id=c.post_id and coalesce(p.visibility,'public')<>'public');
 else raise exception 'Unsupported legacy media source'; end if;
 get diagnostics affected=row_count;
 return affected=1;
end;$$;
revoke all on function public.replace_legacy_private_media(text,uuid,text[],text[]) from public,anon,authenticated;
grant execute on function public.replace_legacy_private_media(text,uuid,text[],text[]) to service_role;

notify pgrst,'reload schema';
commit;
