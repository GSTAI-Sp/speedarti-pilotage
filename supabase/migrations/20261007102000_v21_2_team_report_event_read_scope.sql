drop policy if exists ai_events_select on public.ai_events;
create policy ai_events_select on public.ai_events
for select to authenticated
using (private.current_team_member_id() is not null);

drop policy if exists daily_report_projects_select on public.daily_report_projects;
create policy daily_report_projects_select on public.daily_report_projects
for select to authenticated
using (private.current_team_member_id() is not null);
