-- POC schema: single tenant (no org_id). Mirrors the planned Ticket0 tables.

create table app_setting (
  key    text primary key,
  value  jsonb not null
);

-- Tools a workflow can mention with @key.
create table action (
  key             text primary key check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  name            text not null,
  description     text not null,
  kind            text not null check (kind in ('read', 'write')),
  builtin         boolean not null default false,
  input_schema    jsonb not null,
  subject_field   text,
  amount_field    text,
  autonomy        text not null default 'auto_below_limit'
                  check (autonomy in ('approval_always', 'auto_below_limit', 'auto')),
  max_auto_minor  bigint,
  approver_team   text,
  enabled         boolean not null default true
);

-- Editable draft + live settings; published snapshots live in workflow_version.
create table workflow (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null unique,
  when_to_use              text not null default '',
  steps                    jsonb not null default '[]'::jsonb,
  action_keys              text[] not null default '{}',
  step_count               smallint not null default 0,
  enabled                  boolean not null default false,
  autonomy                 text not null default 'auto_below_limit'
                           check (autonomy in ('approve_all', 'auto_below_limit')),
  published_version_id     uuid,
  has_unpublished_changes  boolean not null default true,
  template                 text,
  archived_at              timestamptz,
  row_version              integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table workflow_version (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references workflow (id),
  version       integer not null,
  name          text not null,
  when_to_use   text not null,
  steps         jsonb not null,
  action_keys   text[] not null,
  published_at  timestamptz not null default now(),
  unique (workflow_id, version)
);

alter table workflow add foreign key (published_version_id) references workflow_version (id);

-- Playground conversations stand in for tickets.
create table conversation (
  id              uuid primary key default gen_random_uuid(),
  customer_name   text not null,
  customer_email  text not null,
  created_at      timestamptz not null default now()
);

create table attachment (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversation (id) on delete cascade,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       integer not null,
  sha256           text not null,
  path             text not null,
  created_at       timestamptz not null default now()
);

-- One execution of a workflow version on a conversation. DBOS workflow id = 'run:' || id.
create table workflow_run (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references conversation (id) on delete cascade,
  workflow_version_id  uuid not null references workflow_version (id),
  status               text not null default 'running' check (status in ('running', 'waiting_customer',
                         'waiting_team', 'paused', 'failed', 'completed', 'escalated', 'expired', 'cancelled')),
  current_node_id      text,
  facts                jsonb not null default '{"collected":{},"outputs":{},"cases":{},"attempts":{}}'::jsonb,
  waiting_for          jsonb,
  outbox               jsonb not null default '[]'::jsonb,
  paused_from          jsonb,
  started_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  ended_at             timestamptz,
  end_reason           text
);

create unique index workflow_run_one_active on workflow_run (conversation_id)
  where status in ('running', 'waiting_customer', 'waiting_team', 'paused', 'failed');

create table message (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversation (id) on delete cascade,
  role             text not null check (role in ('customer', 'bot', 'system')),
  text             text not null default '',
  attachment_ids   uuid[] not null default '{}',
  run_id           uuid references workflow_run (id),
  created_at       timestamptz not null default now()
);

create index message_conversation on message (conversation_id, created_at);

-- Human decisions a run waits on: evidence review (photo) or a write action.
create table approval_task (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references workflow_run (id) on delete cascade,
  conversation_id  uuid not null references conversation (id) on delete cascade,
  node_id          text not null,
  kind             text not null check (kind in ('evidence', 'action')),
  action_key       text,
  action_args      jsonb,
  amount_minor     bigint,
  summary          text not null,
  evidence         jsonb not null default '{}'::jsonb,
  assigned_team    text,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  decided_by       text,
  decided_at       timestamptz,
  decision_note    text,
  due_at           timestamptz,
  created_at       timestamptz not null default now()
);

create unique index approval_task_one_pending on approval_task (run_id, node_id) where status = 'pending';

-- Every action execution; the unique key makes a repeated refund impossible.
create table action_run (
  id                uuid primary key default gen_random_uuid(),
  action_key        text not null,
  run_id            uuid references workflow_run (id) on delete cascade,
  node_id           text,
  idempotency_key   text not null unique,
  mode              text not null check (mode in ('auto', 'approved', 'test')),
  approval_task_id  uuid references approval_task (id),
  args              jsonb not null,
  subject_ref       text,
  amount_minor      bigint,
  policy            jsonb,
  status            text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  result            jsonb,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);

-- Step-by-step timeline (Mongo run_events in the real plan).
create table run_event (
  id       bigserial primary key,
  run_id   uuid not null references workflow_run (id) on delete cascade,
  node_id  text,
  actor    text not null,
  type     text not null,
  data     jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);

create index run_event_run on run_event (run_id, id);

-- Mock shop the demo actions read and write.
create table shop_order (
  id              text primary key,
  customer_email  text not null,
  customer_name   text not null,
  delivered_at    date not null,
  currency        text not null default 'USD',
  items           jsonb not null,
  total_minor     bigint not null,
  refunded_minor  bigint not null default 0
);

insert into action (key, name, description, kind, builtin, input_schema, subject_field, amount_field, autonomy, max_auto_minor, approver_team) values
('lookup_order', 'Lookup order',
 'Find an order by its ID, optionally checking the customer email. Returns found, delivery date, days since delivery, items with prices, total and amount already refunded.',
 'read', false,
 '{"type":"object","properties":{"order_id":{"type":"string"},"email":{"type":"string"}},"required":["order_id"]}',
 'order_id', null, 'auto', null, null),
('refund_order', 'Refund order',
 'Refund money for an order to the original payment method. amount_minor is in cents and must come from the order lookup result.',
 'write', false,
 '{"type":"object","properties":{"order_id":{"type":"string"},"amount_minor":{"type":"integer"},"reason":{"type":"string"}},"required":["order_id","amount_minor","reason"]}',
 'order_id', 'amount_minor', 'auto_below_limit', 10000, 'Finance'),
('request_approval', 'Request approval',
 'Ask a human team to review something (for example a customer photo) before continuing. The workflow waits for their decision.',
 'write', true,
 '{"type":"object","properties":{"summary":{"type":"string"},"team":{"type":"string"}},"required":["summary"]}',
 null, null, 'approval_always', null, 'Returns'),
('escalate_to_human', 'Escalate to human',
 'Hand the conversation to a human agent and stop the workflow.',
 'write', true,
 '{"type":"object","properties":{"reason":{"type":"string"}},"required":["reason"]}',
 null, null, 'auto', null, 'Support');

insert into shop_order (id, customer_email, customer_name, delivered_at, items, total_minor) values
('4512', 'alex@example.com', 'Alex Kim', current_date - 6,
 '[{"sku":"WH-200","name":"Wireless headphones","price_minor":7999,"qty":1}]', 7999),
('4513', 'alex@example.com', 'Alex Kim', current_date - 45,
 '[{"sku":"KB-10","name":"Mechanical keyboard","price_minor":12999,"qty":1}]', 12999),
('4600', 'sam@example.com', 'Sam Rivera', current_date - 3,
 '[{"sku":"BL-9","name":"Pro blender","price_minor":15999,"qty":1}]', 15999),
('4700', 'jo@example.com', 'Jo Patel', current_date - 10,
 '[{"sku":"MG-1","name":"Coffee mug","price_minor":1500,"qty":2},{"sku":"KT-3","name":"Kettle","price_minor":4500,"qty":1}]', 7500);
