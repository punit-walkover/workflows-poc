'use client';

import { useState } from 'react';
import { addVariable, toVarName, WorkflowGraph } from '@/lib/graph';
import { useCanvas } from './context';

// Pick one of the workflow's variables, or create a new one in place. `set` applies the choice to the graph.
export function VarSelect({ value, set, builtins }: { value: string; set: (g: WorkflowGraph, v: string) => WorkflowGraph; builtins?: boolean }) {
  const c = useCanvas();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const own = c.graph.variables ?? [];
  const finish = () => {
    const n = toVarName(name);
    if (n) c.update((g) => set(addVariable(g, n), n));
    setAdding(false); setName('');
  };
  if (adding) return (
    <input autoFocus value={name} placeholder="new_variable" onChange={(e) => setName(e.target.value)} onBlur={finish}
           onKeyDown={(e) => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { setAdding(false); setName(''); } }}
           className="min-w-0 flex-1 rounded border border-brand bg-panel px-1.5 py-0.5 font-mono text-xs outline-none" />
  );
  return (
    <select value={value} disabled={c.readOnly} onChange={(e) => (e.target.value === '+new' ? setAdding(true) : c.update((g) => set(g, e.target.value)))}
            className={`min-w-0 flex-1 rounded border border-line bg-panel px-1 py-0.5 font-mono text-xs ${value ? 'text-var' : 'text-ink-3'}`}>
      <option value="">variable…</option>
      {own.map((v) => <option key={v} value={v}>{v}</option>)}
      {builtins && <optgroup label="Built-in">{c.variables.filter((v) => !own.includes(v.key)).map((v) => <option key={v.key} value={v.key}>{v.key}</option>)}</optgroup>}
      <option value="+new">+ New variable…</option>
    </select>
  );
}
