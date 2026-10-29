-- V21.5 — multi-affectation des tâches + compatibilité historique.
-- assigned_to_member_id reste le responsable principal pour les anciennes intégrations.
-- task_assignees porte la vraie liste des personnes affectées.

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  assignment_role text not null default 'assignee',
  created_at timestamptz not null default now(),
  primary key (task_id, member_id),
  constraint task_assignees_role_check check (assignment_role in ('primary','assignee'))
);

create index if not exists task_assignees_member_idx on public.task_assignees(member_id);

insert into public.task_assignees(task_id, member_id, assignment_role)
select id, assigned_to_member_id, 'primary'
from public.tasks
where assigned_to_member_id is not null
on conflict (task_id,member_id) do update
set assignment_role = 'primary';

alter table public.task_assignees enable row level security;

grant select, insert, update, delete on public.task_assignees to authenticated;

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select
on public.task_assignees for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert
on public.task_assignees for insert to authenticated
with check (
  private.is_admin()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (
        t.assigned_to_member_id = private.current_team_member_id()
        or t.created_by = (select auth.uid())
        or (t.project_id is not null and private.is_project_member(t.project_id))
      )
  )
);

drop policy if exists task_assignees_update on public.task_assignees;
create policy task_assignees_update
on public.task_assignees for update to authenticated
using (
  private.is_admin()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (
        t.assigned_to_member_id = private.current_team_member_id()
        or t.created_by = (select auth.uid())
        or (t.project_id is not null and private.is_project_member(t.project_id))
      )
  )
)
with check (
  private.is_admin()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (
        t.assigned_to_member_id = private.current_team_member_id()
        or t.created_by = (select auth.uid())
        or (t.project_id is not null and private.is_project_member(t.project_id))
      )
  )
);

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete
on public.task_assignees for delete to authenticated
using (
  private.is_admin()
  or exists (
    select 1
    from public.tasks t
    where t.id = task_assignees.task_id
      and (
        t.assigned_to_member_id = private.current_team_member_id()
        or t.created_by = (select auth.uid())
        or (t.project_id is not null and private.is_project_member(t.project_id))
      )
  )
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update
on public.tasks for update to authenticated
using (
  private.is_admin()
  or assigned_to_member_id = private.current_team_member_id()
  or exists (
    select 1 from public.task_assignees ta
    where ta.task_id = tasks.id
      and ta.member_id = private.current_team_member_id()
  )
  or created_by = (select auth.uid())
  or (project_id is not null and private.is_project_member(project_id))
)
with check (
  private.is_admin()
  or assigned_to_member_id = private.current_team_member_id()
  or exists (
    select 1 from public.task_assignees ta
    where ta.task_id = tasks.id
      and ta.member_id = private.current_team_member_id()
  )
  or created_by = (select auth.uid())
  or (project_id is not null and private.is_project_member(project_id))
);
