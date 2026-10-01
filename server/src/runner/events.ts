import { q } from '../db';

// Append-only timeline row; the Run panel and audit read these.
export async function addEvent(runId: string, nodeId: string | null, actor: string, type: string, data: object = {}) {
  await q('insert into run_event (run_id, node_id, actor, type, data) values ($1, $2, $3, $4, $5)', [runId, nodeId, actor, type, JSON.stringify(data)]);
}
