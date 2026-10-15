begin;
set local lock_timeout='3s';
-- Raise only the existing metadata validator; no new tables or stored video bytes.
create or replace function public.validate_post_video(media jsonb,owner_id uuid,post_id uuid) returns void
language plpgsql immutable set search_path='' as $$
begin
 if media is null or media='null'::jsonb then return;end if;
 if jsonb_typeof(media)<>'object' or coalesce(media->>'mimeType','')<>'video/mp4'
  or coalesce(media->>'key','') !~ ('^'||owner_id::text||'/'||post_id::text||'/[0-9a-f-]{36}\.mp4$')
  or coalesce((media->>'duration')::numeric,0)<=0 or (media->>'duration')::numeric>90
  or least(coalesce((media->>'width')::int,0),coalesce((media->>'height')::int,0))<2
  or least((media->>'width')::int,(media->>'height')::int)>1080 or greatest((media->>'width')::int,(media->>'height')::int)>1920
  or coalesce((media->>'size')::int,0) not between 1 and 37748736
  or (media ? 'posterKey' and media->>'posterKey'<>regexp_replace(media->>'key','\.mp4$','.jpg'))
 then raise exception '動画の情報が無効です';end if;
end;$$;
notify pgrst,'reload schema';
commit;
