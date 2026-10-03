create or replace function public.valid_style_spec(spec jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare mode text; field text; part jsonb; candidate jsonb;
begin
  if jsonb_typeof(spec) is distinct from 'object' or spec->>'version' is distinct from '1' or jsonb_typeof(spec->'version') is distinct from 'number'
     or coalesce(spec->>'font', '') not in ('rounded', 'system', 'serif')
     or jsonb_typeof(spec->'radius') is distinct from 'number'
     or (spec->>'radius') !~ '^(0|[1-9]|1[0-9]|2[0-4])$' then return false; end if;
  foreach mode in array array['light','dark'] loop
    if jsonb_typeof(spec->mode) is distinct from 'object' then return false; end if;
    foreach field in array array['background','surface','text','accent','border'] loop
      if jsonb_typeof(spec->mode->field) is distinct from 'string'
         or coalesce(spec->mode->>field, '') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    end loop;
  end loop;
  foreach field in array array['fontSize','spacing','borderWidth'] loop
    if spec ? field then
      if jsonb_typeof(spec->field) is distinct from 'number' then return false; end if;
      if field = 'fontSize' and spec->>field !~ '^(1[2-9]|20)$' then return false; end if;
      if field = 'spacing' and spec->>field !~ '^([4-9]|1[0-9]|2[0-4])$' then return false; end if;
      if field = 'borderWidth' and spec->>field !~ '^[0-3]$' then return false; end if;
    end if;
  end loop;
  if spec ? 'regions' then
    if jsonb_typeof(spec->'regions') is distinct from 'object' then return false; end if;
    for field in select jsonb_object_keys(spec->'regions') loop
      if field not in ('header','sidebar','post','button','text') then return false; end if;
      part := spec->'regions'->field;
      if jsonb_typeof(part) is distinct from 'object' then return false; end if;
      foreach mode in array array['light','dark'] loop
        if part ? mode and jsonb_typeof(part->mode) is distinct from 'object' then return false; end if;
      end loop;
      candidate := (spec - 'regions') || (part - 'light' - 'dark' - 'regions') || jsonb_build_object(
        'light', (spec->'light') || coalesce(part->'light','{}'::jsonb),
        'dark', (spec->'dark') || coalesce(part->'dark','{}'::jsonb));
      if not public.valid_style_spec(candidate) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

notify pgrst, 'reload schema';
