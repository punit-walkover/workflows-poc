import { createHmac } from 'crypto';
import axios from 'axios';
import { Gtwy } from 'gtwy-sdk';
import { config } from '../config';
import { one, q } from '../db';

const g = config.gtwy;
let session: { token: string; exp: number } | null = null;
let agentId: string | null = null;

// HS256 embed JWT for the POC's own GTWY embed user.
function sign(ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ org_id: g.orgId, folder_id: g.folderId, user_id: g.embedUserId, iat: now, exp: now + ttlSeconds })}`;
  return `${body}.${createHmac('sha256', g.accessKey).update(body).digest('base64url')}`;
}

// Chat rejects the raw embed JWT today, so exchange it for a session token (cached until near expiry).
async function sessionToken(force = false): Promise<string> {
  if (!force && session && session.exp - 60 > Date.now() / 1000) return session.token;
  const r = await axios.post(`${g.dbBaseUrl}/api/embed/login`, {}, { headers: { Authorization: sign(300) }, timeout: 30_000 });
  const d = r.data?.data;
  if (!d?.token) throw new Error('gtwy embed login returned no token');
  session = { token: d.token, exp: Number(d.exp) || Date.now() / 1000 + 1200 };
  return session.token;
}

// One GTWY agent for the POC, created on first use and remembered in app_setting.
async function ensureAgent(): Promise<string> {
  if (agentId) return agentId;
  const saved = await one<{ value: string }>(`select value from app_setting where key = 'gtwy_agent_id'`);
  if (saved) return (agentId = saved.value);
  const c = new Gtwy({ Authorization: sign(300), dbBaseUrl: g.dbBaseUrl, timeout: 30_000 } as any) as any;
  const { agent } = await c.agent.create({ service: g.service, model: g.model, type: 'chat', flag: true, name: 'Workflows POC' });
  const versionId = agent?.versions?.[0];
  if (!agent?._id || !versionId) throw new Error('gtwy created no agent version');
  await c.version.update(versionId, { service: g.service, configuration: { model: g.model, prompt: 'You are a customer support assistant.' } });
  await c.version.publish(versionId);
  await q(`insert into app_setting (key, value) values ('gtwy_agent_id', $1) on conflict (key) do update set value = $1`, [JSON.stringify(agent._id)]);
  return (agentId = agent._id);
}

export interface LlmResult { content: string; tokens: number | null; ms: number }

// Stateless call: system prompt overridden per call; json=true asks GTWY for a JSON object.
export async function chat(system: string, user: string, json: boolean): Promise<LlmResult> {
  const id = await ensureAgent();
  const started = Date.now();
  const call = async (token: string) => {
    const c = new Gtwy({ Authorization: token, timeout: 90_000 } as any) as any;
    return c.chat.completions.create({
      agentId: id,
      user,
      configuration: { model: g.model, prompt: system, ...(json ? { response_type: { type: 'json_object' }, temperature: 0 } : {}) },
    });
  };
  let reply: any;
  try {
    reply = await call(await sessionToken());
  } catch (e: any) {
    if (e?.status !== 401 && e?.statusCode !== 401) throw e;
    reply = await call(await sessionToken(true));
  }
  if (!reply?.content) throw new Error('gtwy returned no content');
  return { content: String(reply.content), tokens: reply.usage?.totalTokens ?? null, ms: Date.now() - started };
}

export function parseJson<T>(content: string): T {
  const s = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}
