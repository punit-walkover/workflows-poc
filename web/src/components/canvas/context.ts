'use client';

import { createContext, useContext } from 'react';
import type { GraphItem, WorkflowGraph } from '@/lib/graph';

// Where a dragged step would land: before `index` in a group.
export type DropSlot = { groupId: string; index: number } | null;

// Shared by the canvas, its group nodes and its arrows.
export interface CanvasCtx {
  graph: WorkflowGraph;
  update: (fn: (g: WorkflowGraph) => WorkflowGraph, opts?: { transient?: boolean }) => void;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  loops: Set<string>;                                           // arrows that sit on a loop
  selectEdge: (id: string) => void;
  startItemDrag: (e: React.PointerEvent, drag: { itemId: string } | { make: () => GraphItem; label: string }) => void;
  dropSlot: DropSlot;                                           // shown as a line while dragging a step
  highlight?: { current?: string | null; done?: Set<string> };
  readOnly?: boolean;
}

export const CanvasContext = createContext<CanvasCtx>(null as unknown as CanvasCtx);
export const useCanvas = () => useContext(CanvasContext);
