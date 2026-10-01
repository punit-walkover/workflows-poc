// Fills an action's input template: "{{args.x}}" alone keeps the arg's type; inside text it is interpolated.
const WHOLE = /^\{\{\s*args\.([a-zA-Z0-9_]+)\s*\}\}$/;
const PART = /\{\{\s*args\.([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(tpl: unknown, args: Record<string, unknown>): unknown {
  if (typeof tpl === 'string') {
    const whole = tpl.match(WHOLE);
    if (whole) return args[whole[1]] ?? '';
    return tpl.replace(PART, (_, k) => (args[k] === undefined ? '' : String(args[k])));
  }
  if (Array.isArray(tpl)) return tpl.map((v) => renderTemplate(v, args));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [renderTemplate(k, args) as string, renderTemplate(v, args)]));
  return tpl;
}

// The arg names a template uses, so the builder can warn about undeclared ones.
export function templateArgs(tpl: unknown): string[] {
  const out = new Set<string>();
  JSON.stringify(tpl ?? null).replace(PART, (_, k) => (out.add(k), ''));
  return [...out];
}
