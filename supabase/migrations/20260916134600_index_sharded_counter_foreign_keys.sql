create index if not exists question_count_shards_question_id_idx on public.question_count_shards(question_id);
create index if not exists option_count_shards_question_id_idx on public.option_count_shards(question_id);
create index if not exists option_count_shards_option_id_idx on public.option_count_shards(option_id);
create index if not exists rating_count_shards_question_id_idx on public.rating_count_shards(question_id);
