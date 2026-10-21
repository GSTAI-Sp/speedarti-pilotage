-- V21.4 — droits Direction, dates exactes et progression auto/manuelle.
-- Guillaume reçoit le même rôle administrateur que Thibault.
-- Les projets conservent une progression automatique indépendante de la valeur manuelle.

alter table public.projects
  add column if not exists planned_start date,
  add column if not exists planned_end date,
  add column if not exists progress_mode text not null default 'auto',
  add column if not exists auto_progress smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_progress_mode_check'
  ) then
    alter table public.projects
      add constraint projects_progress_mode_check
      check (progress_mode in ('auto','manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_auto_progress_range'
  ) then
    alter table public.projects
      add constraint projects_auto_progress_range
      check (auto_progress between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_manual_progress_range'
  ) then
    alter table public.projects
      add constraint projects_manual_progress_range
      check (manual_progress between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_planned_dates_order'
  ) then
    alter table public.projects
      add constraint projects_planned_dates_order
      check (planned_start is null or planned_end is null or planned_end >= planned_start);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_planned_dates_order'
  ) then
    alter table public.tasks
      add constraint tasks_planned_dates_order
      check (planned_start is null or planned_end is null or planned_end >= planned_start);
  end if;
end
$$;

-- Même accès administrateur pour Guillaume que pour Thibault.
update public.team_members
set role = 'admin'
where client_key = 'u-guillaume'
  and role is distinct from 'admin';

update public.profiles p
set role = 'admin'
from public.team_members tm
where tm.client_key = 'u-guillaume'
  and tm.profile_id = p.id
  and p.role is distinct from 'admin';

-- Migration douce : les valeurs existantes deviennent le point de départ
-- de l'auto et du manuel avant recalcul complet.
update public.projects
set
  progress_mode = coalesce(nullif(progress_mode,''), 'auto'),
  auto_progress = progress,
  manual_progress = progress
where progress_mode is distinct from 'auto'
   or auto_progress is distinct from progress
   or manual_progress is distinct from progress;

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

  -- Le client ne peut jamais falsifier la valeur auto.
  new.auto_progress := old.auto_progress;

  -- progress est une valeur effective calculée : auto_progress en mode auto,
  -- manual_progress en mode manuel.
  if new.progress_mode = 'manual' then
    new.progress := greatest(0, least(100, new.manual_progress))::smallint;
  else
    new.progress_mode := 'auto';
    new.progress := old.auto_progress;
  end if;

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
      greatest(
        0,
        least(
          100,
          case
            when coalesce(s.total_tasks, 0) > 0
              then round(s.progress_points::numeric / s.total_tasks)::integer
            when p.status = 'completed'
              then 100
            else 0
          end
        )
      )::smallint as automatic_progress
    from public.projects p
    left join task_stats s on s.root_id = p.id
  )
  update public.projects p
  set
    auto_progress = calculated.automatic_progress,
    progress = case
      when p.progress_mode = 'manual'
        then greatest(0, least(100, p.manual_progress))::smallint
      else calculated.automatic_progress
    end,
    updated_at = case
      when p.auto_progress is distinct from calculated.automatic_progress
        or p.progress is distinct from case
          when p.progress_mode = 'manual'
            then greatest(0, least(100, p.manual_progress))::smallint
          else calculated.automatic_progress
        end
      then now()
      else p.updated_at
    end
  from calculated
  where calculated.id = p.id
    and (
      p.auto_progress is distinct from calculated.automatic_progress
      or p.progress is distinct from case
        when p.progress_mode = 'manual'
          then greatest(0, least(100, p.manual_progress))::smallint
        else calculated.automatic_progress
      end
    );

  perform set_config('pilotage.project_progress_system', '0', true);
end;
$$;

select private.refresh_hierarchical_project_progress();

create index if not exists projects_planned_start_idx on public.projects(planned_start);
create index if not exists projects_planned_end_idx on public.projects(planned_end);
