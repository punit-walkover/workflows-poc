-- One row per AI (GTWY) call: which conversation, what it was for, tokens and dollar cost. Feeds the run panel's AI cost.
create table llm_usage (
  id               bigserial primary key,
  conversation_id  uuid references conversation (id) on delete cascade,
  purpose          text not null,
  model            text not null,
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric,
  ms               integer,
  created_at       timestamptz not null default now()
);

create index llm_usage_conversation on llm_usage (conversation_id, id);
