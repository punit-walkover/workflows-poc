-- Custom actions backed by viaSocket app actions (Google Sheets first), and app connections.

create table app_connection (
  service_id     text primary key,
  app_name       text not null,
  auth_id        text not null,
  script_id_enc  text not null,          -- AES-256-GCM; the script id runs the app as this user
  connected_at   timestamptz not null default now()
);

alter table action
  add column source                 text not null default 'mock' check (source in ('builtin', 'mock', 'viasocket')),
  add column via_service_id         text,
  add column via_app_name           text,
  add column via_action_version_id  text,
  add column via_action_name        text,
  add column input_template         jsonb,   -- inputData with {{args.x}} placeholders
  add column created_at             timestamptz not null default now();

update action set source = 'builtin' where builtin;
