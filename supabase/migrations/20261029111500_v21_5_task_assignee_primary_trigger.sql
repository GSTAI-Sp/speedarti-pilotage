-- V21.5 — garantit la compatibilité de tous les anciens flux de création de tâches.
-- Toute valeur assigned_to_member_id est automatiquement reflétée dans task_assignees.

create or replace function private.sync_task_primary_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE'
     and old.assigned_to_member_id is distinct from new.assigned_to_member_id
     and old.assigned_to_member_id is not null then
    delete from public.task_assignees
    where task_id = new.id
      and member_id = old.assigned_to_member_id
      and assignment_role = 'primary';
  end if;

  update public.task_assignees
  set assignment_role = 'assignee'
  where task_id = new.id
    and assignment_role = 'primary';

  if new.assigned_to_member_id is not null then
    insert into public.task_assignees(task_id, member_id, assignment_role)
    values (new.id, new.assigned_to_member_id, 'primary')
    on conflict (task_id, member_id) do update
    set assignment_role = 'primary';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_task_primary_assignee() from public;

drop trigger if exists tasks_sync_primary_assignee on public.tasks;
create trigger tasks_sync_primary_assignee
after insert or update of assigned_to_member_id
on public.tasks
for each row
execute function private.sync_task_primary_assignee();

insert into public.task_assignees(task_id, member_id, assignment_role)
select id, assigned_to_member_id, 'primary'
from public.tasks
where assigned_to_member_id is not null
on conflict (task_id,member_id) do update
set assignment_role = 'primary';
