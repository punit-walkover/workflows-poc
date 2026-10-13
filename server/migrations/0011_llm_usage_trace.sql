-- The full exchange of each AI call (the request sent to GTWY and its reply), and when it started.
alter table llm_usage add column started_at timestamptz, add column trace jsonb;
