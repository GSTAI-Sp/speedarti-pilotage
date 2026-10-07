alter table public.calendar_sources
  add column if not exists owner_member_id uuid references public.team_members(id) on delete cascade;

update public.calendar_sources cs
set owner_member_id = i.owner_member_id
from public.integrations i
where i.id = cs.integration_id
  and cs.owner_member_id is distinct from i.owner_member_id;

create or replace function private.set_calendar_source_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  select i.owner_member_id
  into new.owner_member_id
  from public.integrations i
  where i.id = new.integration_id;

  if new.owner_member_id is null then
    raise exception 'Calendar integration owner not found';
  end if;

  if new.selected then
    new.shared_with_team := true;
  end if;

  return new;
end;
$$;

drop trigger if exists calendar_sources_share_selected on public.calendar_sources;
drop trigger if exists calendar_sources_set_owner on public.calendar_sources;
create trigger calendar_sources_set_owner
before insert or update of integration_id, selected, shared_with_team
on public.calendar_sources
for each row execute function private.set_calendar_source_owner();

drop policy if exists integrations_select_v18 on public.integrations;
create policy integrations_select_v18 on public.integrations
for select to authenticated
using (
  private.is_admin()
  or owner_member_id = private.current_team_member_id()
);

drop policy if exists calendar_sources_select on public.calendar_sources;
create policy calendar_sources_select on public.calendar_sources
for select to authenticated
using (
  private.is_admin()
  or owner_member_id = private.current_team_member_id()
  or (shared_with_team = true and private.current_team_member_id() is not null)
);

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
for select to authenticated
using (
  private.is_admin()
  or exists (
    select 1
    from public.calendar_sources cs
    where cs.id = calendar_events.calendar_source_id
      and (
        cs.owner_member_id = private.current_team_member_id()
        or (cs.shared_with_team = true and private.current_team_member_id() is not null)
      )
  )
);

create index if not exists calendar_sources_owner_member_id_idx
  on public.calendar_sources(owner_member_id);
