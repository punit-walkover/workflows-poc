'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card } from './ui';
import { connectApp, type App } from './connected-apps';

interface Field { key: string; label: string; type: string; required: boolean; help?: string; options?: { label: string; value: unknown }[]; dependsOn: string[]; dynamic: boolean; defaultValue?: unknown; group?: string }
interface CatalogAction { name: string; description: string; action_version_id: string; fields: Field[] }
export interface ArgDef { name: string; type: 'string' | 'integer' | 'number' | 'boolean'; required: boolean; description: string }
export interface ActionDraft {
  key: string; name: string; description: string; kind: 'read' | 'write'; args: ArgDef[];
  subject_field: string; amount_field: string; requires_approval: boolean;
  via_service_id: string; via_app_name: string; via_action_version_id: string; via_action_name: string;
  input_template: Record<string, unknown>;
}

export const emptyDraft = (): ActionDraft => ({
  key: '', name: '', description: '', kind: 'read', args: [], subject_field: '', amount_field: '', requires_approval: false,
  via_service_id: '', via_app_name: '', via_action_version_id: '', via_action_name: '', input_template: {},
});

// Starting inputData for an app action: required fields and fields with defaults, groups nested.
function skeleton(fields: Field[]) {
  const out: Record<string, any> = {};
  const value = (f: Field) => f.defaultValue ?? (f.type === 'multiselect' ? [] : f.type === 'boolean' ? false : '');
  for (const f of fields) {
    if (f.type === 'aifield') continue;
    if (!f.required && f.defaultValue === undefined && f.type !== 'input groups') continue;
    if (f.group) { (out[f.group] ??= {})[f.key.slice(f.group.length + 1)] = value(f); }
    else if (f.type === 'input groups') { if (f.required) out[f.key] ??= {}; }
    else out[f.key] = value(f);
  }
  return out;
}

function setPath(obj: Record<string, any>, key: string, v: unknown, multi: boolean) {
  const copy = structuredClone(obj);
  const parts = key.split('.');
  let cur = copy;
  parts.slice(0, -1).forEach((p) => { cur = cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}; });
  const last = parts[parts.length - 1];
  if (multi) {
    const arr: unknown[] = Array.isArray(cur[last]) ? cur[last] : [];
    cur[last] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  } else cur[last] = v;
  return copy;
}

// Values already chosen, minus {{args}} placeholders, scope the options a field offers.
const existing = (tpl: unknown): any =>
  Array.isArray(tpl) ? tpl.map(existing)
    : tpl && typeof tpl === 'object' ? Object.fromEntries(Object.entries(tpl).filter(([, v]) => !(typeof v === 'string' && v.includes('{{'))).map(([k, v]) => [k, existing(v)]))
    : tpl;

export function ActionBuilder({ initial, isNew }: { initial: ActionDraft; isNew: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<ActionDraft>(initial);
  const [tplText, setTplText] = useState(JSON.stringify(initial.input_template, null, 2));
  const [apps, setApps] = useState<App[]>([]);
  const [catalog, setCatalog] = useState<CatalogAction[]>([]);
  const [search, setSearch] = useState('');
  const [opts, setOpts] = useState<Record<string, { loading?: boolean; error?: string; options?: { label: string; value: unknown }[] }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testArgs, setTestArgs] = useState('');
  const [testOut, setTestOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<ActionDraft>) => setD((x) => ({ ...x, ...patch }));
  const template = useMemo(() => { try { return JSON.parse(tplText); } catch { return null; } }, [tplText]);
  const setTemplate = (t: Record<string, unknown>) => setTplText(JSON.stringify(t, null, 2));
  const chosen = catalog.find((a) => a.action_version_id === d.via_action_version_id);

  useEffect(() => { api('/integrations/apps').then((r) => setApps(r.apps)); }, []);
  useEffect(() => {
    if (!d.via_service_id) return;
    setCatalog([]);
    api<CatalogAction[]>(`/integrations/apps/${d.via_service_id}/actions`).then(setCatalog).catch((e) => setMsg({ ok: false, text: e.message }));
  }, [d.via_service_id]);
  useEffect(() => { setTestArgs(JSON.stringify(Object.fromEntries(d.args.map((a) => [a.name, a.type === 'string' ? '' : 0])), null, 2)); }, [d.args]);

  const pickAction = (a: CatalogAction) => {
    set({ via_action_version_id: a.action_version_id, via_action_name: a.name, name: d.name || a.name, description: d.description || a.description });
    setTemplate(skeleton(a.fields));
    setOpts({});
  };
  const loadOptions = async (f: Field) => {
    setOpts((o) => ({ ...o, [f.key]: { loading: true } }));
    try {
      const r = await api('/integrations/options', { method: 'POST', body: { service_id: d.via_service_id, action_version_id: d.via_action_version_id, field_key: f.key, existing_fields: existing(template ?? {}) } });
      setOpts((o) => ({ ...o, [f.key]: { options: r.options } }));
    } catch (e: any) { setOpts((o) => ({ ...o, [f.key]: { error: e.message } })); }
  };
  const put = (f: Field, v: unknown) => template && setTemplate(setPath(template, f.key, v, f.type === 'multiselect'));

  const save = async () => {
    if (!template) return setMsg({ ok: false, text: 'The input template is not valid JSON.' });
    setBusy(true); setMsg(null);
    try {
      const body = { ...d, input_template: template };
      if (isNew) { await api('/actions', { method: 'POST', body }); router.replace(`/actions/${d.key}`); }
      else { await api(`/actions/${d.key}`, { method: 'PUT', body }); }
      setMsg({ ok: true, text: 'Saved. Workflows can now mention it with @' + d.key + '.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setTestOut(null);
    try { setTestOut(await api(`/actions/${d.key}/test`, { method: 'POST', body: { args: JSON.parse(testArgs || '{}') } })); }
    catch (e: any) { setTestOut({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  };

  const selectedApp = apps.find((a) => a.service_id === d.via_service_id);
  const input = 'w-full rounded-md border border-line bg-panel px-2 py-1.5 outline-none focus:border-ink-3';

  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <div className="mb-5 flex items-center gap-2">
        <Link href="/actions" className="rounded p-1 hover:bg-hover"><ChevronLeft size={18} /></Link>
        <h1 className="text-xl font-semibold">{isNew ? 'New action' : `Edit @${d.key}`}</h1>
        <div className="flex-1" />
        <Button variant="primary" disabled={busy} onClick={save}>{isNew ? 'Create action' : 'Save changes'}</Button>
      </div>
      {msg && <div className={`mb-4 rounded-lg px-4 py-2 ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</div>}

      <Card className="mb-4 px-5 py-4">
        <div className="mb-2 font-medium">1. App</div>
        <div className="flex flex-wrap items-center gap-2">
          {apps.map((a) => (
            <button key={a.service_id} onClick={() => set({ via_service_id: a.service_id, via_app_name: a.name, via_action_version_id: '', via_action_name: '' })}
                    className={`rounded-md border px-3 py-1.5 ${d.via_service_id === a.service_id ? 'border-ink bg-hover font-medium' : 'border-line hover:bg-hover'}`}>
              {a.name} {!a.connected && <span className="text-xs text-ink-3">(not connected)</span>}
            </button>
          ))}
        </div>
        {selectedApp && !selectedApp.connected && (
          <div className="mt-2 flex items-center gap-2 text-sm text-warn">
            Connect {selectedApp.name} to load field options and run tests.
            <Button onClick={async () => { try { await connectApp(selectedApp); setApps((await api('/integrations/apps')).apps); } catch (e: any) { if (e.message) setMsg({ ok: false, text: e.message }); } }}>
              Connect {selectedApp.name}
            </Button>
          </div>
        )}
      </Card>

      {d.via_service_id && (
        <Card className="mb-4 px-5 py-4">
          <div className="mb-2 flex items-center justify-between font-medium">2. App action {d.via_action_name && <span className="text-sm font-normal text-ink-2">selected: {d.via_action_name}</span>}</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions…" className={`${input} mb-2`} />
          <div className="max-h-56 overflow-auto rounded-md border border-line">
            {catalog.length === 0 && <div className="px-3 py-2 text-ink-3">Loading catalog…</div>}
            {catalog.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())).map((a) => (
              <button key={a.action_version_id} onClick={() => pickAction(a)}
                      className={`block w-full border-b border-line px-3 py-2 text-left last:border-0 ${a.action_version_id === d.via_action_version_id ? 'bg-hover' : 'hover:bg-hover/60'}`}>
                <div className="font-medium">{a.name}</div>
                <div className="line-clamp-1 text-xs text-ink-3">{a.description}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {chosen && (
        <div className="mb-4 grid grid-cols-2 gap-4">
          <Card className="px-5 py-4">
            <div className="mb-1 font-medium">3. Arguments the AI fills</div>
            <p className="mb-2 text-xs text-ink-3">Use them in the template as <code>{'{{args.name}}'}</code>. Everything else is fixed below.</p>
            {d.args.map((a, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_90px_auto_auto] items-center gap-2">
                <input value={a.name} placeholder="name" className={input}
                       onChange={(e) => set({ args: d.args.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-z0-9_]/g, '') } : x)) })} />
                <select value={a.type} className={input} onChange={(e) => set({ args: d.args.map((x, j) => (j === i ? { ...x, type: e.target.value as ArgDef['type'] } : x)) })}>
                  {['string', 'integer', 'number', 'boolean'].map((t) => <option key={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.required}
                       onChange={(e) => set({ args: d.args.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> req</label>
                <button className="text-ink-3 hover:text-bad" onClick={() => set({ args: d.args.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                <input value={a.description} placeholder="what it is, where the AI gets it" className={`${input} col-span-4 text-xs`}
                       onChange={(e) => set({ args: d.args.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
              </div>
            ))}
            <Button variant="ghost" onClick={() => set({ args: [...d.args, { name: '', type: 'string', required: true, description: '' }] })}><Plus size={14} /> Add argument</Button>

            <div className="mb-1 mt-5 font-medium">4. Input template</div>
            <textarea value={tplText} onChange={(e) => setTplText(e.target.value)} rows={14} spellCheck={false}
                      className={`${input} font-mono text-xs ${template ? '' : 'border-bad'}`} />
            {!template && <div className="text-xs text-bad">Not valid JSON</div>}
          </Card>

          <Card className="max-h-[640px] overflow-auto px-5 py-4">
            <div className="mb-2 font-medium">Fields of “{chosen.name}”</div>
            {chosen.fields.map((f) => (
              <div key={f.key} className="mb-3 border-b border-line pb-3 last:border-0">
                <div className="flex items-baseline gap-2">
                  <code className="text-xs">{f.key}</code>
                  <span className="text-xs text-ink-3">{f.type}{f.required ? ' · required' : ''}{f.dependsOn.length ? ` · needs ${f.dependsOn.join(', ')}` : ''}</span>
                </div>
                {f.help && <div className="line-clamp-2 text-xs text-ink-2">{f.help}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {f.options?.map((o) => <button key={String(o.value)} onClick={() => put(f, o.value)} className="rounded bg-hover px-1.5 py-0.5 text-xs hover:bg-line">{o.label}</button>)}
                  {f.dynamic && (f.type === 'dropdown' || f.type === 'multiselect') && (
                    <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" onClick={() => loadOptions(f)}>{opts[f.key]?.loading ? 'Loading…' : 'Load options'}</Button>
                  )}
                  {d.args.length > 0 && f.type !== 'input groups' && (
                    <select value="" onChange={(e) => e.target.value && put(f, `{{args.${e.target.value}}}`)} className="rounded border border-line px-1 py-0.5 text-xs">
                      <option value="">← from argument</option>
                      {d.args.filter((a) => a.name).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                    </select>
                  )}
                </div>
                {opts[f.key]?.error && <div className="text-xs text-bad">{opts[f.key]!.error}</div>}
                {opts[f.key]?.options && (
                  <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-auto">
                    {opts[f.key]!.options!.length === 0 && <span className="text-xs text-ink-3">No options (fill the fields it depends on first)</span>}
                    {opts[f.key]!.options!.map((o) => (
                      <button key={String(o.value)} onClick={() => put(f, o.value)} title={String(o.value)} className="rounded bg-action-soft px-1.5 py-0.5 text-xs text-action hover:opacity-80">{o.label}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {chosen && (
        <Card className="mb-4 grid grid-cols-2 gap-4 px-5 py-4">
          <div className="col-span-2 font-medium">5. How the agent uses it</div>
          <label>Key (for @mentions){' '}
            <input value={d.key} disabled={!isNew} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} className={input} placeholder="e.g. sheet_lookup_order" /></label>
          <label>Name <input value={d.name} onChange={(e) => set({ name: e.target.value })} className={input} /></label>
          <label className="col-span-2">Description for the AI: what it does, what it returns
            <textarea value={d.description} rows={2} onChange={(e) => set({ description: e.target.value })} className={input} /></label>
          <label>Kind
            <select value={d.kind} onChange={(e) => set({ kind: e.target.value as 'read' | 'write', requires_approval: e.target.value === 'write' })} className={input}>
              <option value="read">read: runs immediately</option><option value="write">write: changes something</option>
            </select></label>
          <label>Subject argument (one success per value)
            <select value={d.subject_field} onChange={(e) => set({ subject_field: e.target.value })} className={input}>
              <option value="">none</option>{d.args.map((a) => <option key={a.name}>{a.name}</option>)}
            </select></label>
          {d.kind === 'write' && <>
            <label>Amount argument (cents)
              <select value={d.amount_field} onChange={(e) => set({ amount_field: e.target.value })} className={input}>
                <option value="">none</option>{d.args.map((a) => <option key={a.name}>{a.name}</option>)}
              </select></label>
          </>}
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={d.requires_approval} onChange={(e) => set({ requires_approval: e.target.checked })} />
            Needs approval: a teammate must approve before the AI can run it</label>
        </Card>
      )}

      {!isNew && (
        <Card className="px-5 py-4">
          <div className="mb-2 font-medium">6. Test with sample arguments</div>
          <p className="mb-2 text-xs text-ink-3">Runs the real app action once (not part of any workflow run). Save first so the test uses the latest template.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <textarea value={testArgs} onChange={(e) => setTestArgs(e.target.value)} rows={6} className={`${input} font-mono text-xs`} />
              <Button className="mt-2" disabled={busy} onClick={test}>{busy ? 'Running…' : 'Run test'}</Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-canvas p-2 text-[11px]">{testOut ? JSON.stringify(testOut, null, 2) : 'Result appears here'}</pre>
          </div>
        </Card>
      )}
    </div>
  );
}
