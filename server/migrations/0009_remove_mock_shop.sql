-- The mock shop is gone: its two demo actions, the table they read and wrote, and the workflows built on them.
-- Past runs, versions and action_run rows stay as history (action keys there are plain text, not foreign keys).
update workflow set archived_at = now(), enabled = false
where archived_at is null and action_keys && array['lookup_order', 'refund_order'];

delete from action where source = 'mock';
alter table action alter column source set default 'viasocket_flow';

drop table if exists shop_order;
