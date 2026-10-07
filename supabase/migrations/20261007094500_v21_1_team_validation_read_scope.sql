drop policy if exists change_requests_select on public.change_requests;
create policy change_requests_select on public.change_requests
for select to authenticated
using (private.current_team_member_id() is not null);
