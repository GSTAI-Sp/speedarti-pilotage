-- V21 — filtres multi-profils + progression automatique globale.
-- Les écritures restent protégées par les politiques existantes : cette migration
-- élargit uniquement la lecture opérationnelle à l'équipe active et rend la
-- progression serveur entièrement automatique.

alter table public.tasks
  add column if not exists progress smallint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_progress_range'
  ) then
    alter table public.tasks
      add constraint tasks_progress_range check (progress between 0 and 100);
  end if;
end
$$;

create or replace function private.set_task_auto_progress()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  new.progress := case when new.status = 'completed' then 100 else 0 end;
  return new;
end;
$$;

drop trigger if exists tasks_set_auto_progress on public.tasks;
create trigger tasks_set_auto_progress
before insert or update on public.tasks
for each row execute function private.set_task_auto_progress();

update public.tasks
set progress = case when status = 'completed' then 100 else 0 end
where progress is distinct from case when status = 'completed' then 100 else 0 end;

create or replace function private.guard_project_progress_mode()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_system boolean :=
    coalesce(current_setting('pilotage.project_progress_system', true), '') = '1';
begin
  if v_system then
    return new;
  end if;

  new.progress := old.progress;
  new.manual_progress := old.manual_progress;
  return new;
end;
$$;

create or replace function private.refresh_hierarchical_project_progress()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform set_config('pilotage.project_progress_system', '1', true);

  with recursive tree as (
    select p.id as root_id, p.id as node_id
    from public.projects p
    union all
    select tree.root_id, child.id
    from tree
    join public.projects child on child.parent_project_id = tree.node_id
  ),
  task_stats as (
    select
      tree.root_id,
      count(t.id)::integer as total_tasks,
      coalesce(sum(t.progress), 0)::integer as progress_points
    from tree
    left join public.tasks t on t.project_id = tree.node_id
    group by tree.root_id
  ),
  calculated as (
    select
      p.id,
      case
        when coalesce(s.total_tasks, 0) > 0
          then round(s.progress_points::numeric / s.total_tasks)::integer
        when p.status = 'completed'
          then 100
        else 0
      end as effective_progress
    from public.projects p
    left join task_stats s on s.root_id = p.id
  )
  update public.projects p
  set
    progress = greatest(0, least(100, calculated.effective_progress))::smallint,
    manual_progress = greatest(0, least(100, calculated.effective_progress))::smallint,
    updated_at = case
      when p.progress is distinct from greatest(0, least(100, calculated.effective_progress))::smallint
        or p.manual_progress is distinct from greatest(0, least(100, calculated.effective_progress))::smallint
      then now()
      else p.updated_at
    end
  from calculated
  where calculated.id = p.id
    and (
      p.progress is distinct from greatest(0, least(100, calculated.effective_progress))::smallint
      or p.manual_progress is distinct from greatest(0, least(100, calculated.effective_progress))::smallint
    );

  perform set_config('pilotage.project_progress_system', '0', true);
end;
$$;

select private.refresh_hierarchical_project_progress();

create or replace function private.share_selected_calendar_with_team()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.selected then
    new.shared_with_team := true;
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_sources_share_selected on public.calendar_sources;
create trigger calendar_sources_share_selected
before insert or update on public.calendar_sources
for each row execute function private.share_selected_calendar_with_team();

update public.calendar_sources
set shared_with_team = true
where selected = true and shared_with_team is distinct from true;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists integrations_select_v18 on public.integrations;
create policy integrations_select_v18 on public.integrations
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists documents_select on public.project_documents;
create policy documents_select on public.project_documents
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists drive_sync_items_select on public.drive_sync_items;
create policy drive_sync_items_select on public.drive_sync_items
for select to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.integrations i
    where i.id = drive_sync_items.integration_id
      and i.owner_member_id = private.current_team_member_id()
  )
  or (
    drive_sync_items.project_id is not null
    and private.current_team_member_id() is not null
  )
);
