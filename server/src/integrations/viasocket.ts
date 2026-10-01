import { createDecipheriv, createHmac } from 'crypto';
import axios from 'axios';
import { ViaSocket } from 'viasocket-apps';
import { one } from '../db';

// viaSocket for the POC's single end user (VIASOCKET_UID). Tools are built in viaSocket's own builder.
const env = (k: string) => process.env[k] || '';
let client: ViaSocket | null = null;
const sdk = () => {
  if (!env('VIASOCKET_EMBED_SECRET')) throw new Error('viaSocket is not configured (VIASOCKET_* in .env)');
  return (client ??= new ViaSocket({ orgId: env('VIASOCKET_ORG_ID'), projectId: env('VIASOCKET_PROJECT_ID'), secret: env('VIASOCKET_EMBED_SECRET') }));
};

// Token for the tool-builder embed (openViasocket). Signed like GTWY's ({ org_id, project_id, user_id });
// unique_identifier is added so the builder and the Apps API see the same end user.
export function builderToken() {
  if (!env('VIASOCKET_EMBED_SECRET')) throw new Error('viaSocket is not configured (VIASOCKET_* in .env)');
  const uid = env('VIASOCKET_UID') || 'workflows-poc';
  const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({ org_id: env('VIASOCKET_ORG_ID'), project_id: env('VIASOCKET_PROJECT_ID'), user_id: uid, unique_identifier: uid })}`;
  return `${body}.${createHmac('sha256', env('VIASOCKET_EMBED_SECRET')).update(body).digest('base64url')}`;
}

// A tool built in the viaSocket builder: POST the AI's args to its run URL (the URL is the credential).
export async function runFlow(url: string, args: Record<string, unknown>) {
  if (!/^https:\/\/flow\.sokt\.io\/func\/[A-Za-z0-9_-]+$/.test(url)) throw new Error('not a viaSocket flow URL');
  const r = await axios.post(url, args, { timeout: 60_000, validateStatus: () => true });
  if (r.status >= 400) throw new Error(`flow failed (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data ?? {};
}

// Older app actions (source 'viasocket') still run through a stored, encrypted app connection.
const decrypt = (s: string) => {
  const b = Buffer.from(s, 'base64');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(env('POC_ENCRYPTION_KEY'), 'hex'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

export async function runAppAction(serviceId: string, actionVersionId: string, inputData: Record<string, unknown>) {
  const c = await one<{ script_id_enc: string }>('select script_id_enc from app_connection where service_id = $1', [serviceId]);
  if (!c) throw new Error(`App ${serviceId} is not connected`);
  return sdk().runAction(decrypt(c.script_id_enc), actionVersionId, inputData);
}
