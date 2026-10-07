'use client';

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

const LONG = 120; // characters shown before "show more"
const MANY = 5;   // list items shown before "+N more"

// Read-only JSON tree for tool inputs and responses: objects and lists fold, long text and long lists are cut short.
export function JsonView({ value, open = 1 }: { value: unknown; open?: number }) {
  return <div className="font-mono text-[11px] leading-relaxed"><Node value={value} depth={0} open={open} /></div>;
}

function Node({ value, depth, open, name }: { value: unknown; depth: number; open: number; name?: string }) {
  const [expanded, setExpanded] = useState(depth < open);
  const [all, setAll] = useState(false);
  const key = name !== undefined && <span className="text-var">{name}: </span>;

  if (value === null || typeof value !== 'object') return <div>{key}<Leaf value={value} /></div>;

  const list = Array.isArray(value);
  const entries: [string, unknown][] = list ? (value as unknown[]).map((v, i) => [`[${i}]`, v]) : Object.entries(value as object);
  const shown = all ? entries : entries.slice(0, list ? MANY : 50);
  const label = list ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} field${entries.length === 1 ? '' : 's'}`;
  return (
    <div>
      <button type="button" onClick={() => setExpanded((e) => !e)} className="flex items-center gap-0.5 text-left hover:text-ink">
        <ChevronRight size={11} className={`shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {key}<span className="text-ink-3">{list ? `[ ${label} ]` : `{ ${label} }`}</span>
      </button>
      {expanded && (
        <div className="ml-1.5 border-l border-line pl-2">
          {shown.map(([k, v]) => <Node key={k} name={k} value={v} depth={depth + 1} open={open} />)}
          {shown.length < entries.length && (
            <button type="button" onClick={() => setAll(true)} className="text-ink-3 hover:text-ink">+{entries.length - shown.length} more</button>
          )}
        </div>
      )}
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  const [full, setFull] = useState(false);
  if (typeof value !== 'string') return <span className={typeof value === 'number' ? 'text-action' : 'text-brand'}>{String(value)}</span>;
  const cut = !full && value.length > LONG;
  return (
    <span className="break-words text-ok">
      &quot;{cut ? `${value.slice(0, LONG)}…` : value}&quot;
      {value.length > LONG && (
        <button type="button" onClick={() => setFull((f) => !f)} className="ml-1 text-ink-3 hover:text-ink">{full ? 'less' : 'more'}</button>
      )}
    </span>
  );
}
