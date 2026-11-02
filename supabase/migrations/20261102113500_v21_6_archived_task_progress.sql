-- V21.6 — les tâches archivées non terminées ne doivent plus peser dans la progression.
-- Les tâches terminées archivées restent comptées dans l'historique de progression.

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
    left join public.tasks t
      on t.project_id = tree.node_id
     and (t.archived_at is null or t.status = 'completed')
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

drop trigger if exists tasks_refresh_project_tree_progress on public.tasks;
create trigger tasks_refresh_project_tree_progress
after insert or delete or update of status, project_id, archived_at
on public.tasks
for each statement
execute function private.refresh_project_progress_after_task();

select private.refresh_hierarchical_project_progress();
