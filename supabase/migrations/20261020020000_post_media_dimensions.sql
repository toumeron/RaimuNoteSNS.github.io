-- Store image dimensions in immutable object names, retaining existing references
-- and exactly the same ownership/audience checks. No new table or backfill.
begin;
alter policy security_post_media_insert on storage.objects with check (
 bucket_id<>'post-media' or ((storage.foldername(name))[1]=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(--[1-9][0-9]{0,5}x[1-9][0-9]{0,5})?\.(png|jpg|webp|gif|avif)$'));
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('limenote_security.validate_post_media()'::regprocedure);
 definition:=replace(definition,$old$[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$old$,$new$[0-9a-f-]{36}(--[1-9][0-9]{0,5}x[1-9][0-9]{0,5})?\.(png|jpg|webp|gif|avif)$new$);
 execute definition;
end;
$migration$;
commit;
