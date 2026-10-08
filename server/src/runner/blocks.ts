import { BranchNode, Facts, InputFormat, Rule, SaveField } from '../types';

// Checks a customer's reply to an input block. Returns the value to save, or why it doesn't fit.
export function checkAnswer(format: InputFormat, raw: string): { ok: true; value: string | number } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: false };
  switch (format) {
    case 'email': {
      const m = text.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i);
      return m ? { ok: true, value: m[0].toLowerCase() } : { ok: false };
    }
    case 'number': {
      const m = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
      return m ? { ok: true, value: Number(m[0]) } : { ok: false };
    }
    case 'phone': {
      const digits = text.replace(/[^\d+]/g, '');
      return /^\+?\d{7,15}$/.test(digits) ? { ok: true, value: digits } : { ok: false };
    }
    default: return { ok: true, value: text };
  }
}

export const RETRY: Record<InputFormat, string> = {
  text: 'Could you type your answer?',
  email: "That doesn't look like an email address. Could you check it?",
  number: 'Could you send that as a number?',
  phone: "That doesn't look like a phone number. Could you check it?",
};

// One rule against the run's values. Text compares ignore case; > and < compare numbers.
function test(r: Rule, values: Record<string, unknown>): boolean {
  const v = values[r.var];
  const left = v === undefined || v === null ? '' : String(v).trim();
  const other = r.ref ? values[r.ref] : r.value;
  const right = other === undefined || other === null ? '' : String(other).trim();
  switch (r.op) {
    case 'empty': return left === '';
    case 'not_empty': return left !== '';
    case '=': return left.toLowerCase() === right.toLowerCase();
    case '!=': return left.toLowerCase() !== right.toLowerCase();
    case 'contains': return left.toLowerCase().includes(right.toLowerCase());
    case '>': return left !== '' && Number(left) > Number(right);
    case '<': return left !== '' && Number(left) < Number(right);
  }
}

// A rules-mode condition: the first case whose rules match wins; Else catches the rest.
export function chooseByRules(b: BranchNode, values: Record<string, unknown>): { case_id: string | null; reason: string } {
  for (const c of b.cases) {
    if (c.kind === 'else') return { case_id: c.id, reason: 'no rule matched' };
    const rules = c.rules ?? [];
    const hit = rules.length > 0 && (c.join === 'or' ? rules.some((r) => test(r, values)) : rules.every((r) => test(r, values)));
    if (hit) return { case_id: c.id, reason: rules.map((r) => `${r.var} ${r.op} ${r.ref ? `{{${r.ref}}}` : r.value}`.trim()).join(c.join === 'or' ? ' or ' : ' and ') };
  }
  return { case_id: null, reason: 'no rule matched' };
}

// Reads a field from an action response: "delivered_at", "items[0].name", "items.0.name", "items.length".
export function getPath(obj: unknown, path: string): unknown {
  const keys = path.trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined;
    cur = k === 'length' && (Array.isArray(cur) || typeof cur === 'string') ? cur.length : cur[k];
  }
  return cur;
}

// "Save response": copies the mapped fields into workflow variables. Returns what was saved and which paths were missing.
export function saveResponse(facts: Facts, nodeId: string, save: SaveField[] | undefined, output: unknown) {
  const saved: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const m of save ?? []) {
    if (!m.path || !m.var) continue;
    const v = getPath(output, m.path);
    if (v === undefined) { missing.push(m.path); continue; }
    saved[m.var] = v;
  }
  if (Object.keys(saved).length) {
    Object.assign((facts.vars ??= {}), saved);
    (facts.varsBy ??= {})[nodeId] = Object.keys(saved);
  }
  return { saved, missing };
}
