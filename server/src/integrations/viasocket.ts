import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import axios from 'axios';
import { ViaSocket } from 'viasocket-apps';
import { one, q } from '../db';

// viaSocket Apps API for the POC's single end user (VIASOCKET_UID). Only caller of viaSocket.
const env = (k: string) => process.env[k] || '';
let client: ViaSocket | null = null;
const sdk = () => {
  if (!env('VIASOCKET_EMBED_SECRET')) throw new Error('viaSocket is not configured (VIASOCKET_* in .env)');
  return (client ??= new ViaSocket({ orgId: env('VIASOCKET_ORG_ID'), projectId: env('VIASOCKET_PROJECT_ID'), secret: env('VIASOCKET_EMBED_SECRET') }));
};
const user = () => sdk().user(env('VIASOCKET_UID') || 'workflows-poc');

// Apps offered in the UI; any other viaSocket app can be added by its service id.
export const KNOWN_APPS = [
  { service_id: 'rowqm5xi2', name: 'Google Sheets' },
  { service_id: 'rowo0bqrhj5g', name: 'Gmail' },
];

export const embedToken = () => user().token();

// Token for the flow-builder embed (openViasocket). Signed like GTWY's ({ org_id, project_id, user_id });
// unique_identifier is added so the builder and the Apps API see the same end user and connections.
export function builderToken() {
  if (!env('VIASOCKET_EMBED_SECRET')) throw new Error('viaSocket is not configured (VIASOCKET_* in .env)');
  const uid = env('VIASOCKET_UID') || 'workflows-poc';
  const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({ org_id: env('VIASOCKET_ORG_ID'), project_id: env('VIASOCKET_PROJECT_ID'), user_id: uid, unique_identifier: uid })}`;
  return `${body}.${createHmac('sha256', env('VIASOCKET_EMBED_SECRET')).update(body).digest('base64url')}`;
}

// script ids are credentials: stored encrypted, decrypted only to run an action.
const key = () => Buffer.from(env('POC_ENCRYPTION_KEY'), 'hex');
const encrypt = (s: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
};
const decrypt = (s: string) => {
  const b = Buffer.from(s, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

export async function listConnections() {
  return q<{ service_id: string; app_name: string; connected_at: Date }>('select service_id, app_name, connected_at from app_connection order by connected_at');
}

// After the browser's connect popup: reuse an enabled flow or enable once, then keep the script id.
export async function saveConnection(serviceId: string, authId: string, appName: string) {
  const u = user();
  const scriptId = (await u.findEnabled(serviceId)) ?? (await u.enable(serviceId, authId)).scriptId;
  if (!scriptId) throw new Error('viaSocket returned no script id');
  await q(`insert into app_connection (service_id, app_name, auth_id, script_id_enc) values ($1, $2, $3, $4)
           on conflict (service_id) do update set auth_id = $3, script_id_enc = $4, app_name = $2, connected_at = now()`,
    [serviceId, appName, authId, encrypt(scriptId)]);
}

export async function removeConnection(serviceId: string) {
  const c = await connection(serviceId);
  await user().disableFlow(c.scriptId).catch(() => undefined);
  await q('delete from app_connection where service_id = $1', [serviceId]);
}

async function connection(serviceId: string) {
  const c = await one<{ auth_id: string; script_id_enc: string }>('select * from app_connection where service_id = $1', [serviceId]);
  if (!c) throw new Error(`App ${serviceId} is not connected`);
  return { authId: c.auth_id, scriptId: decrypt(c.script_id_enc) };
}

export function runAction(scriptId: string, actionVersionId: string, inputData: Record<string, unknown>) {
  return sdk().runAction(scriptId, actionVersionId, inputData);
}

export async function runAppAction(serviceId: string, actionVersionId: string, inputData: Record<string, unknown>) {
  return runAction((await connection(serviceId)).scriptId, actionVersionId, inputData);
}

// A flow built in the embedded viaSocket panel: POST the AI's args to its run URL (the URL is the credential).
export async function runFlow(url: string, args: Record<string, unknown>) {
  if (!/^https:\/\/flow\.sokt\.io\/func\/[A-Za-z0-9_-]+$/.test(url)) throw new Error('not a viaSocket flow URL');
  const r = await axios.post(url, args, { timeout: 60_000, validateStatus: () => true });
  if (r.status >= 400) throw new Error(`flow failed (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data ?? {};
}

export async function listOptions(serviceId: string, actionVersionId: string, fieldKey: string, existingFields: Record<string, unknown>) {
  const c = await connection(serviceId);
  return user().listOptions(actionVersionId, { fieldKey, authId: c.authId, existingFields });
}

export interface CatalogField { key: string; label: string; type: string; required: boolean; help?: string; options?: { label: string; value: unknown }[];
  dependsOn: string[]; dynamic: boolean; defaultValue?: unknown; group?: string }
export interface CatalogAction { name: string; description: string; action_version_id: string; fields: CatalogField[] }

// An app's actions and their input fields (the catalogue endpoint ticket0-b documents in docs/modules/ticket.md).
const catalogCache = new Map<string, { at: number; actions: CatalogAction[] }>();
export async function catalog(serviceId: string): Promise<CatalogAction[]> {
  const hit = catalogCache.get(serviceId);
  if (hit && Date.now() - hit.at < 3600_000) return hit.actions;
  const r = await axios.post('https://flow.sokt.io/func/scriolZue69X', { service_id: serviceId }, { timeout: 30_000 });
  const rows: any[] = Array.isArray(r.data) ? r.data : [...(r.data?.actions ?? [])];
  const actions = rows.filter((a) => a.type !== 'trigger').map((a): CatalogAction => {
    const ij = a.inputjson ?? {};
    const blocks: Record<string, any> = ij.blocks ?? {};
    const order: string[] = Object.values(ij.steps ?? {}).flat() as string[];
    const keys = [...new Set([...(ij.steps?.root ?? []), ...order, ...Object.keys(blocks)])].filter((k) => blocks[k]);
    return {
      name: a.name, description: a.description ?? '', action_version_id: a.actionversionrecordid,
      fields: keys.filter((k) => blocks[k].type !== 'help').map((k) => {
        const b = blocks[k];
        return { key: k, label: b.label ?? k, type: b.type, required: !!b.required, help: b.help, dependsOn: b.dependsOn ?? [],
                 dynamic: !!(b.source || b.optionsGenerator), options: b.options?.map((o: any) => ({ label: o.label, value: o.value })),
                 defaultValue: b.defaultValue?.value ?? b.defaultValue, group: k.includes('.') ? k.split('.')[0] : undefined };
      }),
    };
  });
  catalogCache.set(serviceId, { at: Date.now(), actions });
  return actions;
}
