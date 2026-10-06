'use client';

import { createContext, useContext } from 'react';
import type { EdgeFrom, WorkflowGraph } from '@/lib/graph';

// Shared by the canvas and its cards: the graph, edits, the endpoint registry and connection state.
export interface CanvasCtx {
  graph: WorkflowGraph;
  update: (fn: (g: WorkflowGraph) => WorkflowGraph, opts?: { transient?: boolean }) => void;
  scale: number;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  register: (key: string) => (el: HTMLElement | null) => void; // endpoints report their element; arrows are measured from them
  startConnect: (from: EdgeFrom, e: React.PointerEvent) => void;
  connecting: boolean;
  highlight?: { current?: string | null; done?: Set<string> };
  readOnly?: boolean;
}

export const CanvasContext = createContext<CanvasCtx>(null as unknown as CanvasCtx);
export const useCanvas = () => useContext(CanvasContext);
