import { config } from '../config';
import { Inline, VARIABLES, WorkflowNode } from '../types';
import { countSteps, mentions } from './tree';

export interface Validation { issues: string[]; action_keys: string[]; step_count: number }

// Structural + reference checks. Drafts save with issues; publish requires none.
export function validateWorkflow(steps: unknown, enabledActions: string[]): Validation {
  const issues: string[] = [];
  if (!Array.isArray(steps)) return { issues: ['steps must be an array'], action_keys: [], step_count: 0 };
  const ids = new Set<string>();

  const text = (content: Inline[]) => content.map((p) => (p.t === 'text' ? p.v : 'x')).join('').trim();
  const checkContent = (content: unknown, where: string, allowEmpty = false) => {
    if (!Array.isArray(content)) return issues.push(`${where}: content must be a list`);
    if (!allowEmpty && !text(content as Inline[])) issues.push(`${where} is empty`);
  };

  // `earlier` = nodes a Go to step here may jump to: earlier siblings and earlier nodes on the path above.
  const walk = (list: WorkflowNode[], depth: number, path: string, earlier: string[]) => {
    const seen = [...earlier];
    list.forEach((n, i) => {
      const where = `${path}${i + 1}`;
      if (!n?.id || ids.has(n.id)) issues.push(`${where}: missing or duplicate id`);
      ids.add(n?.id);
      if (n.type === 'step') checkContent(n.content, `Step ${where}`);
      else if (n.type === 'goto') {
        if (!n.target) issues.push(`Go to ${where}: pick a step to go to`);
        else if (!seen.includes(n.target)) issues.push(`Go to ${where}: can only jump back to an earlier step`);
        if (!Number.isInteger(n.max_visits) || n.max_visits < 1 || n.max_visits > 5) issues.push(`Go to ${where}: repeat limit must be 1 to 5`);
      } else if (n.type === 'branch') {
        if (depth >= config.maxDepth) issues.push(`${where}: conditions can be nested at most ${config.maxDepth} levels`);
        if (!n.cases?.length || n.cases[0].kind !== 'if') issues.push(`${where}: a condition must start with If`);
        n.cases?.forEach((c, ci) => {
          const cw = `${where}.${ci + 1}`;
          if (c.kind === 'else' && ci !== n.cases.length - 1) issues.push(`${cw}: Else must be last`);
          if (c.kind === 'if' && ci !== 0) issues.push(`${cw}: only the first case can be If`);
          if (c.kind !== 'else') checkContent(c.condition, `Condition ${cw}`);
          if (!c.steps?.length) issues.push(`${cw}: add at least one step`);
          ids.add(c.id);
          walk(c.steps ?? [], depth + 1, `${cw}.`, [...seen, n.id]);
        });
      } else issues.push(`${where}: unknown node type`);
      if (n.type !== 'goto') seen.push(n.id);
    });
  };
  walk(steps as WorkflowNode[], 0, '', []);

  const step_count = countSteps(steps as WorkflowNode[]);
  if (step_count > config.maxSteps) issues.push(`Too many steps: ${step_count} of ${config.maxSteps}`);
  if (step_count === 0) issues.push('Add at least one step');

  const { actions, vars } = mentions(steps as WorkflowNode[]);
  actions.filter((k) => !enabledActions.includes(k)).forEach((k) => issues.push(`@${k} doesn't exist or is disabled`));
  vars.filter((k) => !VARIABLES.some((v) => v.key === k)).forEach((k) => issues.push(`Unknown variable {{${k}}}`));
  return { issues, action_keys: actions, step_count };
}
