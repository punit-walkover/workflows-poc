// Edge routing for the canvas. Adapted from Typebot (github.com/baptisteArno/typebot.io, FSL-1.1-ALv2):
// apps/builder/src/features/graph/helpers/{getAnchorsPosition,segments,computeEdgePath}.ts — used here for
// non-commercial learning. Arrows leave a card's right (or left) side and enter a card's top or side, as
// 2–5 orthogonal segments with rounded corners.
import { roundCorners } from 'svg-round-corners';
import { GROUP_WIDTH } from '@/lib/graph';

type Point = { x: number; y: number };
const STUB = 20;
const RADIUS = 20;

const anchors = {
  left: { x: 0, y: STUB },
  top: { x: GROUP_WIDTH / 2, y: 0 },
  right: { x: GROUP_WIDTH, y: STUB },
};

function segments(s: Point, t: Point, side: 'right' | 'left', total: number) {
  const dir = side === 'right' ? 1 : -1;
  if (total === 2) return `L${t.x},${s.y} L${t.x},${t.y}`;
  if (total === 3) {
    const x = s.x + (t.x - s.x) / 2;
    return `L${x},${s.y} L${x},${t.y} L${t.x},${t.y}`;
  }
  if (total === 4) {
    const x = s.x + dir * STUB;
    const y = t.y - STUB;
    return `L${x},${s.y} L${x},${y} L${t.x},${y} L${t.x},${t.y}`;
  }
  const x1 = s.x + dir * STUB;
  const y = s.y + (t.y - s.y) / 2;
  const x2 = t.x - dir * STUB;
  return `L${x1},${s.y} L${x1},${y} L${x2},${y} L${x2},${t.y} L${t.x},${t.y}`;
}

// sourceGroup / targetGroup: card positions; sourceY: the output's height; targetY: a step's height (arrow into a step).
export function edgePath(sourceGroup: Point, sourceY: number, targetGroup: Point, targetY?: number): string {
  let side: 'right' | 'left' = 'right';
  const s = { x: sourceGroup.x + GROUP_WIDTH, y: sourceY };
  if (sourceGroup.x > targetGroup.x) { s.x = sourceGroup.x; side = 'left'; }

  const below = targetGroup.y > sourceY && targetGroup.x < sourceGroup.x + GROUP_WIDTH + STUB && targetGroup.x > sourceGroup.x - GROUP_WIDTH - STUB;
  let t: Point;
  let total: number;
  if (below && targetY === undefined) {
    const exterior = targetGroup.x < sourceGroup.x - GROUP_WIDTH / 2 - STUB || targetGroup.x > sourceGroup.x + GROUP_WIDTH / 2 + STUB;
    t = { x: targetGroup.x + anchors.top.x, y: targetGroup.y + anchors.top.y };
    total = exterior ? 2 : 4;
  } else {
    const a = targetGroup.x < sourceGroup.x ? anchors.right : anchors.left;
    const exterior = targetGroup.x < sourceGroup.x - GROUP_WIDTH || targetGroup.x > sourceGroup.x + GROUP_WIDTH;
    t = { x: targetGroup.x + a.x, y: targetY ?? targetGroup.y + a.y };
    total = exterior ? 3 : 5;
  }
  return roundCorners(`M${s.x},${s.y} ${segments(s, t, side, total)}`, RADIUS).path;
}

// While connecting: from the output to the pointer, as a simple elbow.
export function drawingPath(from: Point, to: Point): string {
  const mid = from.x + Math.max(STUB, (to.x - from.x) / 2);
  return roundCorners(`M${from.x},${from.y} L${mid},${from.y} L${mid},${to.y} L${to.x},${to.y}`, 12).path;
}

// Middle of an edge's route, for its label and settings.
export function edgeMidpoint(sourceGroup: Point, sourceY: number, targetGroup: Point, targetY?: number): Point {
  const sx = sourceGroup.x > targetGroup.x ? sourceGroup.x : sourceGroup.x + GROUP_WIDTH;
  const tx = targetGroup.x + (targetGroup.x < sourceGroup.x ? GROUP_WIDTH : 0);
  return { x: (sx + tx) / 2, y: (sourceY + (targetY ?? targetGroup.y + STUB)) / 2 };
}
