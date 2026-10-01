import { DBOS } from '@dbos-inc/dbos-sdk';
import { Signal } from '../types';
import { act, advance, apply, decide, flush, Next } from './steps';

// The durable run loop. Deterministic: it only branches on checkpointed step results.
async function runLoop(runId: string): Promise<string> {
  let mode: 'run' | 'wait' = 'run';
  let deadline: number | undefined;
  for (;;) {
    if (mode === 'run') {
      const dec = await DBOS.runStep(() => decide(runId), { name: 'decide' });
      const out = dec.kind === 'step' && dec.d.decision === 'call_action'
        ? await DBOS.runStep(() => act(runId, dec), { name: 'act' })
        : null;
      const r: Next = await DBOS.runStep(() => advance(runId, dec, out), { name: 'advance' });
      if (r.next === 'continue') continue;
      await DBOS.runStep(() => flush(runId), { name: 'flush' });
      if (r.next === 'end') return 'done';
      deadline = r.deadline;
    }
    const s = await DBOS.recv<Signal>('signal', deadline ? { deadlineEpochMS: deadline } : { timeoutSeconds: 3600 });
    const a = await DBOS.runStep(() => apply(runId, s), { name: 'apply' });
    await DBOS.runStep(() => flush(runId), { name: 'flush' });
    if (a.next === 'end') return 'done';
    mode = a.next === 'run' ? 'run' : 'wait';
    deadline = a.deadline;
  }
}

export const runWorkflow = DBOS.registerWorkflow(runLoop, { name: 'runWorkflow' });
