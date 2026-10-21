-- V21.4 — correction recette : le changement auto/manuelle doit recalculer
-- immédiatement la progression effective, et un changement de statut projet
-- doit rafraîchir la progression automatique des projets sans tâche.

drop trigger if exists projects_guard_progress_mode on public.projects;

create trigger projects_guard_progress_mode
before update of progress, manual_progress, progress_mode, auto_progress
on public.projects
for each row
execute function private.guard_project_progress_mode();

drop trigger if exists projects_refresh_tree_progress_update on public.projects;

create trigger projects_refresh_tree_progress_update
after update of parent_project_id, status
on public.projects
for each statement
execute function private.refresh_project_progress_after_hierarchy();
