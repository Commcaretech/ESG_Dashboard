begin;

do $$
begin
  if to_regrole('authenticated') is null
    or to_regrole('anonymous') is null
    or to_regprocedure('auth.user_id()') is null then
    raise exception 'Neon Data API prerequisites are missing for database %', current_database()
      using hint = 'Enable Data API with Managed Better Auth on this branch and database, then rerun this migration.';
  end if;
end;
$$;

create schema if not exists esghub_private;
revoke all on schema esghub_private from public;
grant usage on schema public to authenticated;
create table public.user_profiles (
  user_id text primary key,
  role text not null check (role in ('viewer','editor'))
);
create table public.reporting_years (
  year integer primary key check (year between 2026 and 9999),
  catalog_version integer not null check (catalog_version > 0),
  unique (year,catalog_version)
);
create table public.metric_definitions (
  catalog_version integer not null,
  metric_id text not null,
  definition jsonb not null,
  primary key (catalog_version,metric_id)
);
create table public.narrative_definitions (
  catalog_version integer not null,
  record_type text not null,
  definition jsonb not null,
  primary key (catalog_version,record_type)
);
create table public.metric_values (
  year integer not null,
  catalog_version integer not null,
  scope text not null check (scope = 'community_care'),
  metric_id text not null,
  period integer not null check (period between 0 and 12),
  value numeric check (value between 0 and 9007199254740991),
  source text not null default '' check (length(source) <= 500),
  remarks text not null default '' check (length(remarks) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (year,scope,metric_id,period),
  foreign key (year,catalog_version) references public.reporting_years(year,catalog_version),
  foreign key (catalog_version,metric_id) references public.metric_definitions(catalog_version,metric_id),
  check (value is null or btrim(source) <> '')
);
create table public.narrative_records (
  year integer not null,
  catalog_version integer not null,
  scope text not null check (scope = 'community_care'),
  record_type text not null,
  slot integer not null check (slot > 0),
  fields jsonb not null,
  source text not null default '' check (length(source) <= 500),
  remarks text not null default '' check (length(remarks) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (year,scope,record_type,slot),
  foreign key (year,catalog_version) references public.reporting_years(year,catalog_version),
  foreign key (catalog_version,record_type) references public.narrative_definitions(catalog_version,record_type)
);
create table public.change_audit (
  id bigint generated always as identity primary key,
  table_name text not null,
  operation text not null,
  actor text,
  changed_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);
create function esghub_private.can_access(write_access boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_profiles where user_id = (select auth.user_id())
    and (not write_access or role = 'editor'));
$$;
revoke all on function esghub_private.can_access(boolean) from public;
grant usage on schema esghub_private to authenticated;
grant execute on function esghub_private.can_access(boolean) to authenticated;
create function esghub_private.validate_metric() returns trigger
language plpgsql set search_path = '' as $$
declare spec jsonb;
begin
  if current_user = 'authenticated' and not esghub_private.can_access(true) then
    raise exception 'Editor permission required' using errcode = '42501';
  end if;
  select definition into strict spec from public.metric_definitions
    where catalog_version=new.catalog_version and metric_id=new.metric_id;
  if jsonb_typeof(spec->'depends') = 'array' or (spec->>'rule' = 'annual') <> (new.period=0)
    or (spec->>'type' = 'count' and new.value <> trunc(new.value))
    or (spec->>'type' = 'flag' and new.value not in (0,1)) then
    raise exception 'Value, period or metric is invalid' using errcode = '23514';
  end if;
  new.updated_by := auth.user_id();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create function esghub_private.validate_narrative() returns trigger
language plpgsql set search_path = '' as $$
declare spec jsonb; item jsonb; idx integer := 0; field_type text; raw text;
begin
  if current_user = 'authenticated' and not esghub_private.can_access(true) then
    raise exception 'Editor permission required' using errcode = '42501';
  end if;
  select definition into strict spec from public.narrative_definitions
    where catalog_version=new.catalog_version and record_type=new.record_type;
  if jsonb_typeof(new.fields) <> 'array' or new.slot > (spec->>'limit')::integer then
    raise exception 'Invalid reporting record' using errcode = '23514';
  end if;
  if jsonb_array_length(new.fields) <> jsonb_array_length(spec->'fields') then
    raise exception 'Invalid reporting fields' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(new.fields) loop
    field_type := spec->'types'->>idx;
    if item <> 'null'::jsonb and (spec->'fixed_context'->(new.slot::text)->>(idx::text)) is not null then
      raise exception 'Fixed workbook field' using errcode = '23514';
    end if;
    idx := idx+1;
    if item = 'null'::jsonb then continue; end if;
    raw := item #>> '{}';
    if jsonb_typeof(item) <> 'string' or length(raw) > 5000
      or (field_type = 'count' and raw !~ '^[0-9]+$')
      or (field_type = 'decimal' and raw !~ '^[0-9]+(\.[0-9]+)?$')
      or (field_type = 'date' and raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Invalid field value' using errcode = '23514';
    end if;
    if field_type = 'date' then perform raw::date; end if;
  end loop;
  new.updated_by := auth.user_id();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create function esghub_private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.change_audit(table_name,operation,actor,old_record,new_record)
  values (tg_table_name,tg_op,auth.user_id(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end;
$$;
revoke all on function esghub_private.validate_metric(),esghub_private.validate_narrative(),esghub_private.audit_change() from public;
create trigger validate_metric before insert or update on public.metric_values
  for each row execute function esghub_private.validate_metric();
create trigger validate_narrative before insert or update on public.narrative_records
  for each row execute function esghub_private.validate_narrative();

do $$
declare t text;
begin
  foreach t in array array['user_profiles','reporting_years','metric_definitions','narrative_definitions','metric_values','narrative_records','change_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anonymous,authenticated',t);
  end loop;
  foreach t in array array['reporting_years','metric_definitions','narrative_definitions','metric_values','narrative_records'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy staff_read on public.%I for select to authenticated using ((select esghub_private.can_access()))',t);
  end loop;
  foreach t in array array['metric_values','narrative_records'] loop
    execute format('grant insert,update on public.%I to authenticated',t);
    execute format('create policy editor_insert on public.%I for insert to authenticated with check ((select esghub_private.can_access(true)))',t);
    execute format('create policy editor_update on public.%I for update to authenticated using ((select esghub_private.can_access(true))) with check ((select esghub_private.can_access(true)))',t);
  end loop;
  foreach t in array array['metric_values','narrative_records','user_profiles'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function esghub_private.audit_change()',t);
  end loop;
end $$;
revoke update on public.metric_values,public.narrative_records from authenticated;
grant update (value,source,remarks) on public.metric_values to authenticated;
grant update (fields,source,remarks) on public.narrative_records to authenticated;
grant select on public.user_profiles to authenticated;
create policy self_profile on public.user_profiles for select to authenticated
  using (user_id = (select auth.user_id()) and (select esghub_private.can_access()));
insert into public.reporting_years values (2026,1);
commit;

