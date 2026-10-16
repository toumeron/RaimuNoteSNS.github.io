-- Raise membership capacity without changing ownership, validation or privileges.
begin;
create or replace function public.validate_user_list() returns trigger language plpgsql set search_path='' as $$
declare member jsonb; external_count integer:=0;
begin
 if tg_op='INSERT' and (select count(*) from public.user_lists where owner_id=new.owner_id)>=100 then raise exception 'Lists limit reached'; end if;
 new.name:=btrim(new.name);
 if new.cover_ref is not null and new.cover_ref !~ ('^cloudinary:lists/'||new.owner_id||'/'||new.id||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$') then raise exception 'Invalid list cover'; end if;
 if jsonb_typeof(new.members) is distinct from 'array' or jsonb_array_length(new.members)>500 then raise exception 'Invalid members';end if;
 if (select count(distinct m->>'id') from jsonb_array_elements(new.members) m)<>jsonb_array_length(new.members) then raise exception 'Duplicate member';end if;
 for member in select * from jsonb_array_elements(new.members) loop
  if jsonb_typeof(member) is distinct from 'object' or jsonb_typeof(member->'id') is distinct from 'string' or char_length(member->>'id') not between 1 and 200 or jsonb_typeof(member->'username') is distinct from 'string' or char_length(member->>'username') not between 1 and 200 or char_length(member::text)>5000 then raise exception 'Invalid member';end if;
  if (member->>'id') !~ '^[0-9a-f-]{36}$' then external_count:=external_count+1;end if;
 end loop;
 if external_count>500 then raise exception 'External members limit reached';end if;
 new.updated_at:=now();return new;
end;$$;
commit;
