create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.owns_poll(target_poll uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.polls p
    where p.id = target_poll
      and p.owner_id = (select auth.uid())
  );
$$;

create or replace function private.owns_session(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.poll_sessions s
    join public.polls p on p.id = s.poll_id
    where s.id = target_session
      and p.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_poll(uuid) from public, anon;
revoke all on function private.owns_session(uuid) from public, anon;
grant execute on function private.owns_poll(uuid) to authenticated;
grant execute on function private.owns_session(uuid) to authenticated;

drop policy if exists "questions owner all" on public.questions;
create policy "questions owner all" on public.questions for all to authenticated
  using (private.owns_poll(poll_id)) with check (private.owns_poll(poll_id));

drop policy if exists "options owner all" on public.answer_options;
create policy "options owner all" on public.answer_options for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and private.owns_poll(q.poll_id)))
  with check (exists (select 1 from public.questions q where q.id = question_id and private.owns_poll(q.poll_id)));

drop policy if exists "sessions owner all" on public.poll_sessions;
create policy "sessions owner all" on public.poll_sessions for all to authenticated
  using (private.owns_poll(poll_id)) with check (private.owns_poll(poll_id));

drop policy if exists "participants owner read" on public.participants;
create policy "participants owner read" on public.participants for select to authenticated
  using (private.owns_session(session_id));

drop policy if exists "responses owner read" on public.responses;
create policy "responses owner read" on public.responses for select to authenticated
  using (private.owns_session(session_id));

drop policy if exists "response options owner read" on public.response_options;
create policy "response options owner read" on public.response_options for select to authenticated
  using (exists (select 1 from public.responses r where r.id = response_id and private.owns_session(r.session_id)));

drop policy if exists "session stats owner read" on public.session_stats;
create policy "session stats owner read" on public.session_stats for select to authenticated
  using (private.owns_session(session_id));

drop policy if exists "question stats owner read" on public.question_stats;
create policy "question stats owner read" on public.question_stats for select to authenticated
  using (private.owns_session(session_id));

drop policy if exists "option counts owner read" on public.option_counts;
create policy "option counts owner read" on public.option_counts for select to authenticated
  using (private.owns_session(session_id));

drop policy if exists "rating counts owner read" on public.rating_counts;
create policy "rating counts owner read" on public.rating_counts for select to authenticated
  using (private.owns_session(session_id));

revoke all on function public.owns_poll(uuid) from public, anon, authenticated;
revoke all on function public.owns_session(uuid) from public, anon, authenticated;
drop function public.owns_poll(uuid);
drop function public.owns_session(uuid);

create index if not exists option_counts_option_id_idx on public.option_counts(option_id);
create index if not exists option_counts_question_id_idx on public.option_counts(question_id);
create index if not exists poll_sessions_active_question_id_idx on public.poll_sessions(active_question_id);
create index if not exists question_stats_question_id_idx on public.question_stats(question_id);
create index if not exists rating_counts_question_id_idx on public.rating_counts(question_id);
create index if not exists response_options_option_id_idx on public.response_options(option_id);
