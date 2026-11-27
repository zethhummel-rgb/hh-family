-- Keep previously enabled palettes available until an administrator sets a schedule.
alter table private.hh_seasonal_palettes
 add column starts_on date,
 add column stops_on date,
 drop constraint hh_seasonal_palettes_palette_check,
 add constraint hh_seasonal_palettes_palette_check
  check (palette in ('spring','summer','autumn','winter','easter','halloween','christmas','thanksgiving')),
 add constraint hh_seasonal_palettes_window_check
  check (starts_on is null or stops_on is null or stops_on>starts_on);

create function private.hh_palette_date(value jsonb) returns date
language plpgsql immutable set search_path='' as $$
declare text_value text:=value#>>'{}';
begin
 if value is null or value='null'::jsonb then return null;end if;
 if jsonb_typeof(value) is distinct from 'string' or text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  raise exception 'Enter a valid schedule date in YYYY-MM-DD format';
 end if;
 return text_value::date;
exception when invalid_datetime_format or datetime_field_overflow then
 raise exception 'Enter a valid schedule date in YYYY-MM-DD format';
end;
$$;
revoke all on function private.hh_palette_date(jsonb) from public,anon,authenticated;

create function private.hh_set_seasonal_palette(payload jsonb) returns void
language plpgsql set search_path='' as $$
declare
 selected_palette text:=payload->>'palette';
 setting private.hh_seasonal_palettes%rowtype;
 starts date;
 stops date;
 enable_palette boolean;
begin
 if selected_palette is null or selected_palette not in ('spring','summer','autumn','winter','easter','halloween','christmas','thanksgiving')
  or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose a seasonal palette and on or off';end if;
 enable_palette:=(payload->>'enabled')::boolean;

 -- Lock the current window before combining new dates and omitted dates.
 insert into private.hh_seasonal_palettes(palette,enabled) values(selected_palette,false) on conflict (palette) do nothing;
 select * into setting from private.hh_seasonal_palettes where palette=selected_palette for update;
 starts:=case when payload ? 'starts_on' then private.hh_palette_date(payload->'starts_on') else setting.starts_on end;
 stops:=case when payload ? 'stops_on' then private.hh_palette_date(payload->'stops_on') else setting.stops_on end;
 if starts is not null and stops is not null and stops<=starts then raise exception 'The end date must be after the start date';end if;
 update private.hh_seasonal_palettes set enabled=enable_palette,starts_on=starts,stops_on=stops
 where palette=selected_palette and (enabled,starts_on,stops_on) is distinct from (enable_palette,starts,stops);
end;
$$;
revoke all on function private.hh_set_seasonal_palette(jsonb) from public,anon,authenticated;

create or replace function private.hh_content_snapshot(include_archived boolean) returns jsonb
language sql stable set search_path='' as $$
 with windows as (
  select catalog.palette,catalog.position,coalesce(p.enabled,false) as enabled,p.starts_on,p.stops_on,
   p.starts_on::timestamp at time zone 'America/Toronto' as starts_at,
   p.stops_on::timestamp at time zone 'America/Toronto' as stops_at
  from unnest(array['spring','summer','autumn','winter','easter','halloween','christmas','thanksgiving'])
   with ordinality as catalog(palette,position)
  left join private.hh_seasonal_palettes p on p.palette=catalog.palette
 ), schedule as (
  select w.*,enabled and (starts_at is null or starts_at<=now()) and (stops_at is null or stops_at>now()) as active
  from windows w
 )
 select jsonb_build_object(
  'notices',coalesce((
   select jsonb_agg(
    jsonb_build_object('id',n.id,'kind',n.kind,'title',n.title,'body',n.body,'published_at',n.published_at)
    || case when include_archived then jsonb_build_object('archived_at',n.archived_at) else '{}'::jsonb end
    order by n.published_at desc,n.id
   )
   from private.hh_app_notices n where include_archived or n.archived_at is null
  ),'[]'::jsonb),
  'seasonal_palettes',coalesce((
   select jsonb_agg(p.palette order by p.position) from schedule p where case when include_archived then p.enabled else p.active end
  ),'[]'::jsonb)
 ) || case when include_archived then jsonb_build_object('palette_schedule',(
  select jsonb_agg(jsonb_build_object('palette',p.palette,'enabled',p.enabled,'starts_on',p.starts_on,'stops_on',p.stops_on) order by p.position)
  from schedule p
 )) else jsonb_build_object(
  'palette_expiries',coalesce((
   select jsonb_object_agg(p.palette,to_char(p.stops_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   from schedule p where p.active and p.stops_at is not null
  ),'{}'::jsonb),
  'next_palette_change_at',(
   select to_char(min(b.at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
   from schedule p cross join lateral (values (p.starts_at),(p.stops_at)) b(at)
   where p.enabled and b.at>now()
  )
 ) end;
$$;

-- Change only the palette action, preserving the existing admin gate and notice actions.
do $schedule$
declare
 definition text:=pg_get_functiondef('private.hh_admin_content(text,jsonb)'::regprocedure);
 old_action constant text:=$old$ elsif action='set_palette' then
  if payload->>'palette' is null or payload->>'palette' not in ('spring','summer','autumn','winter')
   or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose a seasonal palette and on or off';end if;
  insert into private.hh_seasonal_palettes(palette,enabled) values(payload->>'palette',(payload->>'enabled')::boolean)
  on conflict (palette) do update set enabled=excluded.enabled
  where hh_seasonal_palettes.enabled is distinct from excluded.enabled;$old$;
 new_action constant text:=$new$ elsif action='set_palette' then
  perform private.hh_set_seasonal_palette(payload);$new$;
begin
 if position(old_action in definition)=0 then raise exception 'Expected the existing seasonal palette action';end if;
 execute replace(definition,old_action,new_action);
end;
$schedule$;
