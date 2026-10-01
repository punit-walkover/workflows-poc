-- Align the POC with the final plan: one "requires approval" flag, Go to step visits, team messages, widget chats.

-- Actions: a single flag replaces autonomy / limits / approver teams.
alter table action add column requires_approval boolean not null default false;
update action set requires_approval = true where key in ('refund_order', 'sheet_refund_order') or (not builtin and autonomy = 'approval_always');
alter table action drop column autonomy, drop column max_auto_minor, drop column approver_team;

alter table workflow drop column autonomy;

-- Approvals go to one org-wide inbox.
alter table approval_task drop column assigned_team;

-- waiting_team → waiting_approval.
drop index workflow_run_one_active;
alter table workflow_run drop constraint workflow_run_status_check;
update workflow_run set status = 'waiting_approval' where status = 'waiting_team';
update workflow_run set waiting_for = jsonb_set(waiting_for, '{type}', '"approval"') where waiting_for->>'type' = 'team';
alter table workflow_run add constraint workflow_run_status_check check (status in ('running', 'waiting_customer',
  'waiting_approval', 'paused', 'failed', 'completed', 'escalated', 'expired', 'cancelled'));
create unique index workflow_run_one_active on workflow_run (conversation_id)
  where status in ('running', 'waiting_customer', 'waiting_approval', 'paused', 'failed');
update workflow_run set facts = facts || '{"visits":{}}'::jsonb where not facts ? 'visits';

-- Go to step re-runs a node: each visit gets its own action_run.
alter table action_run add column visit integer not null default 1, drop column policy;

-- Teammates can write in the chat.
alter table message drop constraint message_role_check;
alter table message add constraint message_role_check check (role in ('customer', 'bot', 'team', 'system'));

-- Where the chat came from: the playground or the embedded widget.
alter table conversation add column channel text not null default 'playground' check (channel in ('playground', 'widget'));
