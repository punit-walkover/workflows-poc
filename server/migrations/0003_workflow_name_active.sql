-- Names only need to be unique among workflows that aren't deleted (archived).
alter table workflow drop constraint workflow_name_key;
create unique index workflow_name_active on workflow (name) where archived_at is null;
