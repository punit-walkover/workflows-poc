-- Actions built in viaSocket's embedded flow builder: the AI calls the flow's run URL with its args.
alter table action drop constraint action_source_check;
alter table action add constraint action_source_check check (source in ('builtin', 'mock', 'viasocket', 'viasocket_flow'));
alter table action
  add column via_flow_id   text unique,
  add column via_flow_url  text;   -- https://flow.sokt.io/func/<flow_id>; treat like a credential
