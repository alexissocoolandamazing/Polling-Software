-- PulsePoll initial schema. Apply with `supabase db push`.
create extension if not exists pgcrypto;

create type public.question_type as enum (
  'single_choice', 'multiple_choice', 'yes_no', 'rating', 'free_text'
);
create type public.session_status as enum ('draft', 'live', 'ended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  allow_vote_changes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 500),
  type public.question_type not null,
  position integer not null check (position >= 0),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now()
);

create table public.poll_sessions (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  join_code text not null unique check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  status public.session_status not null default 'draft',
  active_question_id uuid references public.questions(id) on delete set null,
  voting_open boolean not null default false,
  results_visible boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  token_hash text not null check (char_length(token_hash) = 64),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_vote_at timestamptz,
  unique (session_id, token_hash)
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  text_answer text check (text_answer is null or char_length(text_answer) between 1 and 2000),
  rating_answer integer,
  last_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, participant_id, question_id),
  unique (participant_id, last_request_id)
);

create table public.response_options (
  response_id uuid not null references public.responses(id) on delete cascade,
  option_id uuid not null references public.answer_options(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (response_id, option_id)
);

-- Small, incrementally maintained result tables keep the live read path O(options),
-- not O(total votes), and avoid one aggregate query per connected screen.
create table public.session_stats (
  session_id uuid primary key references public.poll_sessions(id) on delete cascade,
  participant_count integer not null default 0 check (participant_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.question_stats (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  response_count integer not null default 0 check (response_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

create table public.option_counts (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  option_id uuid not null references public.answer_options(id) on delete cascade,
  vote_count integer not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, option_id)
);

create table public.rating_counts (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  rating integer not null,
  vote_count integer not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, rating)
);

create index polls_owner_created_idx on public.polls (owner_id, created_at desc);
create index questions_poll_position_idx on public.questions (poll_id, position);
create index answer_options_question_position_idx on public.answer_options (question_id, position);
create index sessions_poll_created_idx on public.poll_sessions (poll_id, created_at desc);
create index sessions_live_code_idx on public.poll_sessions (join_code) where status <> 'ended';
create index participants_session_joined_idx on public.participants (session_id, joined_at);
create index responses_session_question_idx on public.responses (session_id, question_id);
create index responses_question_created_idx on public.responses (question_id, created_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();
create trigger polls_updated before update on public.polls
for each row execute function public.set_updated_at();
create trigger questions_updated before update on public.questions
for each row execute function public.set_updated_at();
create trigger sessions_updated before update on public.poll_sessions
for each row execute function public.set_updated_at();
create trigger responses_updated before update on public.responses
for each row execute function public.set_updated_at();

create or replace function public.handle_new_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.handle_new_admin();

create or replace function public.owns_poll(target_poll uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.polls p
    where p.id = target_poll and p.owner_id = (select auth.uid())
  );
$$;

create or replace function public.owns_session(target_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.poll_sessions s
    join public.polls p on p.id = s.poll_id
    where s.id = target_session and p.owner_id = (select auth.uid())
  );
$$;

create or replace function public.validate_active_question()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.active_question_id is not null and not exists (
    select 1 from public.questions q
    where q.id = new.active_question_id and q.poll_id = new.poll_id
  ) then
    raise exception using errcode = '23514', message = 'Active question must belong to the session poll';
  end if;
  if new.status = 'ended' then
    new.voting_open := false;
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  if new.voting_open and (new.status <> 'live' or new.active_question_id is null) then
    raise exception using errcode = '23514', message = 'Voting requires a live session and active question';
  end if;
  return new;
end;
$$;
create trigger validate_session_question before insert or update on public.poll_sessions
for each row execute function public.validate_active_question();

create or replace function public.initialize_session_stats()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.session_stats (session_id) values (new.id);
  insert into public.question_stats (session_id, question_id)
    select new.id, q.id from public.questions q where q.poll_id = new.poll_id;
  insert into public.option_counts (session_id, question_id, option_id)
    select new.id, q.id, o.id
    from public.questions q join public.answer_options o on o.question_id = q.id
    where q.poll_id = new.poll_id;
  return new;
end;
$$;
create trigger initialize_session after insert on public.poll_sessions
for each row execute function public.initialize_session_stats();

create or replace function public.increment_participant_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.session_stats
  set participant_count = participant_count + 1, updated_at = now()
  where session_id = new.session_id;
  return new;
end;
$$;
create trigger count_participant after insert on public.participants
for each row execute function public.increment_participant_count();

create or replace function public.adjust_response_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.question_stats (session_id, question_id, response_count)
    values (new.session_id, new.question_id, 1)
    on conflict (session_id, question_id)
    do update set response_count = public.question_stats.response_count + 1, updated_at = now();
  else
    update public.question_stats set response_count = greatest(0, response_count - 1), updated_at = now()
    where session_id = old.session_id and question_id = old.question_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger count_response after insert or delete on public.responses
for each row execute function public.adjust_response_count();

create or replace function public.adjust_option_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_response public.responses;
begin
  select * into source_response from public.responses
  where id = coalesce(new.response_id, old.response_id);
  if tg_op = 'INSERT' then
    insert into public.option_counts (session_id, question_id, option_id, vote_count)
    values (source_response.session_id, source_response.question_id, new.option_id, 1)
    on conflict (session_id, question_id, option_id)
    do update set vote_count = public.option_counts.vote_count + 1, updated_at = now();
  else
    update public.option_counts set vote_count = greatest(0, vote_count - 1), updated_at = now()
    where session_id = source_response.session_id
      and question_id = source_response.question_id and option_id = old.option_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger count_selected_option after insert or delete on public.response_options
for each row execute function public.adjust_option_count();

create or replace function public.adjust_rating_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.rating_answer is not null then
    update public.rating_counts set vote_count = greatest(0, vote_count - 1), updated_at = now()
    where session_id = old.session_id and question_id = old.question_id and rating = old.rating_answer;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.rating_answer is not null then
    insert into public.rating_counts (session_id, question_id, rating, vote_count)
    values (new.session_id, new.question_id, new.rating_answer, 1)
    on conflict (session_id, question_id, rating)
    do update set vote_count = public.rating_counts.vote_count + 1, updated_at = now();
  end if;
  return coalesce(new, old);
end;
$$;
create trigger count_rating after insert or update or delete on public.responses
for each row execute function public.adjust_rating_count();

-- State is safe to broadcast on an unguessable, session-specific public topic.
-- Vote details and participant tokens are never included.
create or replace function public.broadcast_session_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status, 'activeQuestionId', new.active_question_id,
      'votingOpen', new.voting_open, 'resultsVisible', new.results_visible
    ),
    'session_state', 'session:' || new.join_code, false
  );
  return new;
end;
$$;
create trigger broadcast_session after insert or update on public.poll_sessions
for each row execute function public.broadcast_session_state();

create or replace function public.broadcast_visible_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare session_code text;
declare visible boolean;
declare payload jsonb;
begin
  select s.join_code, s.results_visible into session_code, visible
  from public.poll_sessions s where s.id = new.session_id;
  if visible then
    -- Public clients treat this as an invalidation only and fetch authoritative
    -- aggregate state. Counts are not trusted from a client-sendable channel.
    payload := jsonb_build_object('questionId', new.question_id);
    perform realtime.send(payload, 'result_update', 'session:' || session_code, false);
  end if;
  return new;
end;
$$;
create trigger broadcast_question_result after insert or update on public.question_stats
for each row execute function public.broadcast_visible_result();
create trigger broadcast_option_result after insert or update on public.option_counts
for each row execute function public.broadcast_visible_result();
create trigger broadcast_rating_result after insert or update on public.rating_counts
for each row execute function public.broadcast_visible_result();

-- Atomic, idempotent vote command. Only the server secret may execute it.
create or replace function public.submit_vote(
  p_join_code text,
  p_token_hash text,
  p_question_id uuid,
  p_request_id uuid,
  p_option_ids uuid[] default null,
  p_text_answer text default null,
  p_rating_answer integer default null
)
returns table (saved_response_id uuid, total_responses integer)
language plpgsql security definer set search_path = '' as $$
declare
  target_session public.poll_sessions;
  target_participant public.participants;
  target_question public.questions;
  target_poll public.polls;
  existing_response public.responses;
  response_uuid uuid;
  selected_count integer := coalesce(cardinality(p_option_ids), 0);
  valid_option_count integer;
  rating_min integer;
  rating_max integer;
begin
  select * into target_session from public.poll_sessions where join_code = upper(p_join_code) for share;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;

  select * into target_poll from public.polls where id = target_session.poll_id;
  select * into target_question from public.questions
    where id = p_question_id and poll_id = target_session.poll_id;
  if not found then raise exception using errcode = 'P0001', message = 'QUESTION_NOT_FOUND'; end if;

  select * into target_participant from public.participants
    where session_id = target_session.id and token_hash = p_token_hash for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVALID_PARTICIPANT'; end if;

  select * into existing_response from public.responses
  where session_id = target_session.id and participant_id = target_participant.id and question_id = p_question_id;
  if found and existing_response.last_request_id = p_request_id then
    return query select existing_response.id, qs.response_count
      from public.question_stats qs
      where qs.session_id = target_session.id and qs.question_id = p_question_id;
    return;
  end if;

  if target_session.status <> 'live' or not target_session.voting_open then
    raise exception using errcode = 'P0001', message = 'VOTING_CLOSED';
  end if;
  if target_session.active_question_id is distinct from p_question_id then
    raise exception using errcode = 'P0001', message = 'QUESTION_NOT_ACTIVE';
  end if;
  if existing_response.id is not null and not target_poll.allow_vote_changes then
    raise exception using errcode = '23505', message = 'ALREADY_VOTED';
  end if;

  update public.participants
    set last_vote_at = now(), last_seen_at = now()
    where id = target_participant.id
      and (last_vote_at is null or last_vote_at < now() - interval '300 milliseconds');
  if not found then raise exception using errcode = 'P0001', message = 'RATE_LIMITED'; end if;

  if target_question.type in ('single_choice', 'yes_no', 'multiple_choice') then
    if (target_question.type in ('single_choice', 'yes_no') and selected_count <> 1)
      or (target_question.type = 'multiple_choice' and selected_count < 1) then
      raise exception using errcode = 'P0001', message = 'INVALID_SELECTION_COUNT';
    end if;
    select count(distinct o.id) into valid_option_count
    from public.answer_options o
    where o.question_id = p_question_id and o.id = any(p_option_ids);
    if valid_option_count <> selected_count then
      raise exception using errcode = 'P0001', message = 'INVALID_OPTIONS';
    end if;
    p_text_answer := null; p_rating_answer := null;
  elsif target_question.type = 'rating' then
    rating_min := coalesce((target_question.settings ->> 'min')::integer, 1);
    rating_max := coalesce((target_question.settings ->> 'max')::integer, 5);
    if p_rating_answer is null or p_rating_answer < rating_min or p_rating_answer > rating_max then
      raise exception using errcode = 'P0001', message = 'INVALID_RATING';
    end if;
    p_option_ids := null; p_text_answer := null;
  elsif target_question.type = 'free_text' then
    p_text_answer := nullif(btrim(p_text_answer), '');
    if p_text_answer is null or char_length(p_text_answer) > 2000 then
      raise exception using errcode = 'P0001', message = 'INVALID_TEXT';
    end if;
    p_option_ids := null; p_rating_answer := null;
  end if;

  if existing_response.id is null then
    insert into public.responses (
      session_id, participant_id, question_id, text_answer, rating_answer, last_request_id
    ) values (
      target_session.id, target_participant.id, p_question_id, p_text_answer, p_rating_answer, p_request_id
    ) returning id into response_uuid;
  else
    response_uuid := existing_response.id;
    delete from public.response_options where response_id = response_uuid;
    update public.responses set text_answer = p_text_answer, rating_answer = p_rating_answer,
      last_request_id = p_request_id where id = response_uuid;
  end if;

  if p_option_ids is not null then
    insert into public.response_options (response_id, option_id)
    select response_uuid, option_id from unnest(p_option_ids) as option_id;
  end if;

  return query select response_uuid, qs.response_count
    from public.question_stats qs
    where qs.session_id = target_session.id and qs.question_id = p_question_id;
end;
$$;

revoke all on function public.submit_vote(text, text, uuid, uuid, uuid[], text, integer) from public, anon, authenticated;
grant execute on function public.submit_vote(text, text, uuid, uuid, uuid[], text, integer) to service_role;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.profiles, public.polls, public.questions,
  public.answer_options, public.poll_sessions to authenticated;
grant select on public.participants, public.responses, public.response_options,
  public.session_stats, public.question_stats, public.option_counts, public.rating_counts to authenticated;
revoke all on function public.owns_poll(uuid), public.owns_session(uuid) from public, anon;
grant execute on function public.owns_poll(uuid), public.owns_session(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.polls enable row level security;
alter table public.questions enable row level security;
alter table public.answer_options enable row level security;
alter table public.poll_sessions enable row level security;
alter table public.participants enable row level security;
alter table public.responses enable row level security;
alter table public.response_options enable row level security;
alter table public.session_stats enable row level security;
alter table public.question_stats enable row level security;
alter table public.option_counts enable row level security;
alter table public.rating_counts enable row level security;

create policy "profiles read own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "polls owner all" on public.polls for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "questions owner all" on public.questions for all to authenticated
  using (public.owns_poll(poll_id)) with check (public.owns_poll(poll_id));
create policy "options owner all" on public.answer_options for all to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id and public.owns_poll(q.poll_id)))
  with check (exists (select 1 from public.questions q where q.id = question_id and public.owns_poll(q.poll_id)));
create policy "sessions owner all" on public.poll_sessions for all to authenticated
  using (public.owns_poll(poll_id)) with check (public.owns_poll(poll_id));
create policy "participants owner read" on public.participants for select to authenticated
  using (public.owns_session(session_id));
create policy "responses owner read" on public.responses for select to authenticated
  using (public.owns_session(session_id));
create policy "response options owner read" on public.response_options for select to authenticated
  using (exists (select 1 from public.responses r where r.id = response_id and public.owns_session(r.session_id)));
create policy "session stats owner read" on public.session_stats for select to authenticated
  using (public.owns_session(session_id));
create policy "question stats owner read" on public.question_stats for select to authenticated
  using (public.owns_session(session_id));
create policy "option counts owner read" on public.option_counts for select to authenticated
  using (public.owns_session(session_id));
create policy "rating counts owner read" on public.rating_counts for select to authenticated
  using (public.owns_session(session_id));

-- Only authenticated admin viewers consume Postgres Changes. Public audience
-- updates use the narrow database broadcasts above.
do $$ begin
  alter publication supabase_realtime add table public.poll_sessions;
  alter publication supabase_realtime add table public.session_stats;
  alter publication supabase_realtime add table public.question_stats;
  alter publication supabase_realtime add table public.option_counts;
  alter publication supabase_realtime add table public.rating_counts;
exception when duplicate_object then null;
end $$;
