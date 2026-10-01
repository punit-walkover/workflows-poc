import type { Inline } from '@/lib/tree';

// Read-only rendering of step text with @action / {{var}} chips.
export function InlineText({ content }: { content: Inline[] }) {
  if (!content.length) return <span className="text-ink-3">(empty)</span>;
  return (
    <>
      {content.map((p, i) => p.t === 'text'
        ? <span key={i}>{p.v}</span>
        : <span key={i} className={`chip ${p.t === 'action' ? 'chip-action' : 'chip-var'}`}>{p.t === 'action' ? `@${p.key}` : `{{${p.key}}}`}</span>)}
    </>
  );
}
