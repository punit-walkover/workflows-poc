'use client';

import { BaseEdge, Edge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { GraphEdge, removeEdge, setEdge } from '@/lib/graph';
import { MAX_VISITS } from '@/lib/tree';
import { useCanvas } from './context';

export type WfEdgeType = Edge<{ edge: GraphEdge }, 'wf'>;
export const EDGE_COLOR = { idle: '#a3a39d', loop: '#2a5bd7', selected: '#e8420c' };

// A right-angled arrow with rounded corners. Loop arrows are dashed and labelled with their repeat limit;
// a selected arrow shows its settings.
export function WfEdge({ id, data, selected, markerEnd, ...p }: EdgeProps<WfEdgeType>) {
  const c = useCanvas();
  const [path, x, y] = getSmoothStepPath({ ...p, borderRadius: 14, offset: 28 });
  const loop = c.loops.has(id);
  const e = data!.edge;
  const stroke = selected ? EDGE_COLOR.selected : loop ? EDGE_COLOR.loop : EDGE_COLOR.idle;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={18}
                style={{ stroke, strokeWidth: 2, strokeDasharray: loop ? '6 4' : undefined }} />
      {(loop || (selected && !c.readOnly)) && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1"
               style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, zIndex: selected ? 1001 : undefined }}>
            {loop && (
              <button onClick={() => c.selectEdge(id)}
                      className="rounded-full border border-action/30 bg-action-soft px-1.5 py-0.5 text-[10px] font-medium text-action">
                ↺ {e.maxVisits ? `max ${e.maxVisits}` : 'no limit'}
              </button>
            )}
            {selected && !c.readOnly && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs shadow-lg">
                {loop && <>
                  <label className="flex items-center gap-1">repeat at most
                    <input type="number" min={1} max={MAX_VISITS} value={e.maxVisits ?? ''} placeholder="—"
                           onChange={(ev) => c.update((g) => setEdge(g, id, { maxVisits: ev.target.value ? Math.min(MAX_VISITS, Math.max(1, Math.round(Number(ev.target.value)))) : undefined }))}
                           className="w-14 rounded border border-line px-1 py-0.5" />×</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={!!e.fresh} onChange={(ev) => c.update((g) => setEdge(g, id, { fresh: ev.target.checked }))} /> ask again</label>
                </>}
                <button title="Delete arrow (Del)" onClick={() => c.update((g) => removeEdge(g, id))} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={13} /></button>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
