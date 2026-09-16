create table if not exists public.question_count_shards (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  shard smallint not null check (shard between 0 and 31),
  response_count integer not null default 0 check (response_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, shard)
);

create table if not exists public.option_count_shards (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  option_id uuid not null references public.answer_options(id) on delete cascade,
  shard smallint not null check (shard between 0 and 31),
  vote_count integer not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, option_id, shard)
);

create table if not exists public.rating_count_shards (
  session_id uuid not null references public.poll_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  rating integer not null,
  shard smallint not null check (shard between 0 and 31),
  vote_count integer not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, rating, shard)
);

alter table public.question_count_shards enable row level security;
alter table public.option_count_shards enable row level security;
alter table public.rating_count_shards enable row level security;

revoke all on public.question_count_shards, public.option_count_shards, public.rating_count_shards from public, anon, authenticated;
grant select on public.question_count_shards, public.option_count_shards, public.rating_count_shards to authenticated;
grant all on public.question_count_shards, public.option_count_shards, public.rating_count_shards to service_role;

create policy "question count shards owner read" on public.question_count_shards for select to authenticated using (private.owns_session(session_id));
create policy "option count shards owner read" on public.option_count_shards for select to authenticated using (private.owns_session(session_id));
create policy "rating count shards owner read" on public.rating_count_shards for select to authenticated using (private.owns_session(session_id));

insert into public.question_count_shards (session_id, question_id, shard, response_count)
select r.session_id, r.question_id,
       (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint as shard,
       count(*)::integer
from public.responses r
group by r.session_id, r.question_id, (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint
on conflict (session_id, question_id, shard) do update
set response_count = excluded.response_count, updated_at = now();

insert into public.option_count_shards (session_id, question_id, option_id, shard, vote_count)
select r.session_id, r.question_id, ro.option_id,
       (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint as shard,
       count(*)::integer
from public.response_options ro
join public.responses r on r.id = ro.response_id
group by r.session_id, r.question_id, ro.option_id, (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint
on conflict (session_id, question_id, option_id, shard) do update
set vote_count = excluded.vote_count, updated_at = now();

insert into public.rating_count_shards (session_id, question_id, rating, shard, vote_count)
select r.session_id, r.question_id, r.rating_answer,
       (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint as shard,
       count(*)::integer
from public.responses r
where r.rating_answer is not null
group by r.session_id, r.question_id, r.rating_answer, (((hashtextextended(r.participant_id::text, 0) % 32) + 32) % 32)::smallint
on conflict (session_id, question_id, rating, shard) do update
set vote_count = excluded.vote_count, updated_at = now();

create or replace function public.adjust_response_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_shard smallint;
begin
  if tg_op = 'INSERT' then
    v_shard := (((hashtextextended(new.participant_id::text, 0) % 32) + 32) % 32)::smallint;
    insert into public.question_count_shards (session_id, question_id, shard, response_count)
    values (new.session_id, new.question_id, v_shard, 1)
    on conflict (session_id, question_id, shard) do update
      set response_count = public.question_count_shards.response_count + 1, updated_at = now();
  else
    v_shard := (((hashtextextended(old.participant_id::text, 0) % 32) + 32) % 32)::smallint;
    update public.question_count_shards
      set response_count = greatest(0, response_count - 1), updated_at = now()
      where session_id = old.session_id and question_id = old.question_id and shard = v_shard;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.adjust_option_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_response public.responses; v_shard smallint; v_response_id uuid;
begin
  if tg_op = 'INSERT' then v_response_id := new.response_id; else v_response_id := old.response_id; end if;
  select * into source_response from public.responses where id = v_response_id;
  if not found then return coalesce(new, old); end if;
  v_shard := (((hashtextextended(source_response.participant_id::text, 0) % 32) + 32) % 32)::smallint;
  if tg_op = 'INSERT' then
    insert into public.option_count_shards (session_id, question_id, option_id, shard, vote_count)
    values (source_response.session_id, source_response.question_id, new.option_id, v_shard, 1)
    on conflict (session_id, question_id, option_id, shard) do update
      set vote_count = public.option_count_shards.vote_count + 1, updated_at = now();
  else
    update public.option_count_shards
      set vote_count = greatest(0, vote_count - 1), updated_at = now()
      where session_id = source_response.session_id and question_id = source_response.question_id
        and option_id = old.option_id and shard = v_shard;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.adjust_rating_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_shard smallint;
begin
  if tg_op in ('DELETE', 'UPDATE') and old.rating_answer is not null then
    v_shard := (((hashtextextended(old.participant_id::text, 0) % 32) + 32) % 32)::smallint;
    update public.rating_count_shards
      set vote_count = greatest(0, vote_count - 1), updated_at = now()
      where session_id = old.session_id and question_id = old.question_id
        and rating = old.rating_answer and shard = v_shard;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.rating_answer is not null then
    v_shard := (((hashtextextended(new.participant_id::text, 0) % 32) + 32) % 32)::smallint;
    insert into public.rating_count_shards (session_id, question_id, rating, shard, vote_count)
    values (new.session_id, new.question_id, new.rating_answer, v_shard, 1)
    on conflict (session_id, question_id, rating, shard) do update
      set vote_count = public.rating_count_shards.vote_count + 1, updated_at = now();
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.adjust_response_count() from public, anon, authenticated;
revoke execute on function public.adjust_option_count() from public, anon, authenticated;
revoke execute on function public.adjust_rating_count() from public, anon, authenticated;

create or replace function public.submit_vote(
  p_join_code text,
  p_token_hash text,
  p_question_id uuid,
  p_request_id uuid,
  p_option_ids uuid[] default null::uuid[],
  p_text_answer text default null::text,
  p_rating_answer integer default null::integer
)
returns table(saved_response_id uuid, total_responses integer)
language plpgsql security definer set search_path = '' as $$
declare
  target_session public.poll_sessions; target_participant public.participants; target_question public.questions; target_poll public.polls; existing_response public.responses; response_uuid uuid;
  selected_count integer := coalesce(cardinality(p_option_ids), 0); valid_option_count integer; rating_min integer; rating_max integer;
begin
  select * into target_session from public.poll_sessions where join_code = upper(p_join_code) for share;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  select * into target_poll from public.polls where id = target_session.poll_id;
  select * into target_question from public.questions where id = p_question_id and poll_id = target_session.poll_id;
  if not found then raise exception using errcode = 'P0001', message = 'QUESTION_NOT_FOUND'; end if;
  select * into target_participant from public.participants where session_id = target_session.id and token_hash = p_token_hash for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVALID_PARTICIPANT'; end if;
  select * into existing_response from public.responses where session_id = target_session.id and participant_id = target_participant.id and question_id = p_question_id;
  if found and existing_response.last_request_id = p_request_id then
    return query select existing_response.id,
      coalesce((select sum(qs.response_count)::integer from public.question_count_shards qs where qs.session_id = target_session.id and qs.question_id = p_question_id), 0);
    return;
  end if;
  if target_session.status <> 'live' or not target_session.voting_open then raise exception using errcode = 'P0001', message = 'VOTING_CLOSED'; end if;
  if target_session.active_question_id is distinct from p_question_id then raise exception using errcode = 'P0001', message = 'QUESTION_NOT_ACTIVE'; end if;
  if existing_response.id is not null and not target_poll.allow_vote_changes then raise exception using errcode = '23505', message = 'ALREADY_VOTED'; end if;
  update public.participants set last_vote_at = now(), last_seen_at = now() where id = target_participant.id and (last_vote_at is null or last_vote_at < now() - interval '300 milliseconds');
  if not found then raise exception using errcode = 'P0001', message = 'RATE_LIMITED'; end if;
  if target_question.type in ('single_choice', 'yes_no', 'multiple_choice') then
    if (target_question.type in ('single_choice', 'yes_no') and selected_count <> 1) or (target_question.type = 'multiple_choice' and selected_count < 1) then raise exception using errcode = 'P0001', message = 'INVALID_SELECTION_COUNT'; end if;
    select count(distinct o.id) into valid_option_count from public.answer_options o where o.question_id = p_question_id and o.id = any(p_option_ids);
    if valid_option_count <> selected_count then raise exception using errcode = 'P0001', message = 'INVALID_OPTIONS'; end if;
    p_text_answer := null; p_rating_answer := null;
  elsif target_question.type = 'rating' then
    rating_min := coalesce((target_question.settings ->> 'min')::integer, 1); rating_max := coalesce((target_question.settings ->> 'max')::integer, 5);
    if p_rating_answer is null or p_rating_answer < rating_min or p_rating_answer > rating_max then raise exception using errcode = 'P0001', message = 'INVALID_RATING'; end if;
    p_option_ids := null; p_text_answer := null;
  elsif target_question.type = 'free_text' then
    p_text_answer := nullif(btrim(p_text_answer), '');
    if p_text_answer is null or char_length(p_text_answer) > 2000 then raise exception using errcode = 'P0001', message = 'INVALID_TEXT'; end if;
    p_option_ids := null; p_rating_answer := null;
  end if;
  if existing_response.id is null then
    insert into public.responses (session_id, participant_id, question_id, text_answer, rating_answer, last_request_id)
    values (target_session.id, target_participant.id, p_question_id, p_text_answer, p_rating_answer, p_request_id) returning id into response_uuid;
  else
    response_uuid := existing_response.id;
    delete from public.response_options where response_id = response_uuid;
    update public.responses set text_answer = p_text_answer, rating_answer = p_rating_answer, last_request_id = p_request_id where id = response_uuid;
  end if;
  if p_option_ids is not null then insert into public.response_options (response_id, option_id) select response_uuid, option_id from unnest(p_option_ids) as option_id; end if;
  return query select response_uuid,
    coalesce((select sum(qs.response_count)::integer from public.question_count_shards qs where qs.session_id = target_session.id and qs.question_id = p_question_id), 0);
end;
$$;

revoke execute on function public.submit_vote(text,text,uuid,uuid,uuid[],text,integer) from public, anon, authenticated;
grant execute on function public.submit_vote(text,text,uuid,uuid,uuid[],text,integer) to service_role;

drop trigger if exists broadcast_question_shard_result on public.question_count_shards;
drop trigger if exists broadcast_option_shard_result on public.option_count_shards;
drop trigger if exists broadcast_rating_shard_result on public.rating_count_shards;
create trigger broadcast_question_shard_result after insert or update on public.question_count_shards for each row execute function public.broadcast_visible_result();
create trigger broadcast_option_shard_result after insert or update on public.option_count_shards for each row execute function public.broadcast_visible_result();
create trigger broadcast_rating_shard_result after insert or update on public.rating_count_shards for each row execute function public.broadcast_visible_result();

do $$ begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_count_shards'
  ) then alter publication supabase_realtime add table public.question_count_shards; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'option_count_shards'
  ) then alter publication supabase_realtime add table public.option_count_shards; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rating_count_shards'
  ) then alter publication supabase_realtime add table public.rating_count_shards; end if;
end $$;
