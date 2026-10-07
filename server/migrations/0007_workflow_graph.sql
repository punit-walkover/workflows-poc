-- Canvas workflows: groups of steps joined by edges. When `graph` is set it is the workflow; `steps` is the older tree form.
alter table workflow add column graph jsonb;
alter table workflow_version add column graph jsonb;
