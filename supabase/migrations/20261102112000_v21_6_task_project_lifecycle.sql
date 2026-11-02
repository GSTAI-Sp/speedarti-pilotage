-- V21.6 — Pause / Sommeil / Archivage / Planification automatique.
-- Les dates deviennent la source du classement Roadmap.
-- Les tâches terminées dont la date est passée sont archivées automatiquement.

alter table public.tasks
  add column if not exists archived_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status = any(array[
    'todo','in_progress','to_validate','to_test','completed','blocked','paused','sleeping'
  ]::text[]));

alter table public.projects
  drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status = any(array[
    'todo','in_progress','to_validate','to_test','completed','blocked','paused','sleeping'
  ]::text[]));

create or replace function private.normalize_task_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_plan_date date;
  v_end_date date;
  v_week_end date := (date_trunc('week', current_date)::date + 6);
  v_month_end date := ((date_trunc('month', current_date) + interval '1 month - 1 day')::date);
begin
  v_plan_date := coalesce(
    new.planned_start,
    new.scheduled_for,
    new.planned_end,
    (new.due_at at time zone 'Europe/Paris')::date
  );

  v_end_date := coalesce(
    new.planned_end,
    new.planned_start,
    new.scheduled_for,
    (new.due_at at time zone 'Europe/Paris')::date
  );

  if v_plan_date is null then
    new.planning_bucket := 'backlog';
    new.planning_status := 'unplanned';
    new.needs_planning := true;
  else
    new.planning_status := 'planned';
    new.needs_planning := false;

    if v_plan_date <= v_week_end then
      new.planning_bucket := 'this_week';
    elsif v_plan_date <= v_month_end then
      new.planning_bucket := 'this_month';
    elsif v_plan_date <= (current_date + interval '3 months')::date then
      new.planning_bucket := 'next_3_months';
    else
      new.planning_bucket := 'later';
    end if;
  end if;

  if new.status = 'completed'
     and v_end_date is not null
     and v_end_date < current_date then
    new.archived_at := coalesce(new.archived_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_normalize_lifecycle on public.tasks;
create trigger tasks_normalize_lifecycle
before insert or update
on public.tasks
for each row
execute function private.normalize_task_lifecycle();

-- Backfill immédiat : reclassement des tâches existantes + archivage des terminées passées.
update public.tasks
set updated_at = updated_at;

create index if not exists tasks_archived_at_idx on public.tasks(archived_at);
