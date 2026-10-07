'use client';

import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Mention from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extensions';
import { PluginKey } from '@tiptap/pm/state';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Inline } from '@/lib/tree';

interface MenuItem { id: string; label: string; hint?: string; kind: 'action' | 'var' | 'condition' }
type Menu = { items: MenuItem[]; index: number; rect: DOMRect | null; command: (i: MenuItem) => void } | null;

interface Props {
  content: Inline[];
  onChange: (c: Inline[]) => void;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  onCondition?: () => void;
}

// Inline[] ⇄ TipTap JSON. The server never sees TipTap's format.
const toDoc = (c: Inline[]): JSONContent => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: c.flatMap((p): JSONContent[] => p.t === 'text'
      ? (p.v ? [{ type: 'text', text: p.v }] : [])
      : [{ type: 'mention', attrs: { id: p.key, label: p.key, mentionSuggestionChar: p.t === 'action' ? '@' : '{{' } }]),
  }],
});

const fromDoc = (doc: JSONContent): Inline[] => {
  const out: Inline[] = [];
  const push = (v: string) => { const last = out[out.length - 1]; if (last?.t === 'text') last.v += v; else out.push({ t: 'text', v }); };
  (doc.content ?? []).forEach((para, i) => {
    if (i > 0) push(' ');
    (para.content ?? []).forEach((n) => {
      if (n.type === 'text') push(n.text ?? '');
      else if (n.type === 'mention') out.push(n.attrs?.mentionSuggestionChar === '{{' ? { t: 'var', key: n.attrs.id } : { t: 'action', key: n.attrs?.id });
    });
  });
  return out;
};

export function StepEditor(props: Props) {
  const [menu, setMenu] = useState<Menu>(null);
  const menuRef = useRef<Menu>(null);
  const live = useRef(props);
  menuRef.current = menu;
  live.current = props;

  // One suggestion popup per trigger; items come from the latest props via `live`.
  const suggestion = (char: '@' | '{{', key: string) => ({
    char,
    pluginKey: new PluginKey(key),
    allowSpaces: false,
    items: ({ query }: { query: string }): MenuItem[] => {
      const qy = query.toLowerCase();
      if (char === '{{') return live.current.variables.filter((v) => v.key.includes(qy)).map((v) => ({ id: v.key, label: v.key, hint: v.label, kind: 'var' }));
      const items: MenuItem[] = live.current.actions.filter((a) => a.enabled && (a.key.includes(qy) || a.name.toLowerCase().includes(qy)))
        .map((a) => ({ id: a.key, label: a.key, hint: a.name, kind: 'action' }));
      if (live.current.onCondition && 'condition'.includes(qy)) items.push({ id: '__condition', label: 'Condition', hint: 'Turn this step into If / Else', kind: 'condition' });
      return items;
    },
    command: ({ editor, range, props: item }: any) => {
      if (item.kind === 'condition') { editor.chain().focus().deleteRange(range).run(); live.current.onCondition?.(); return; }
      editor.chain().focus().insertContentAt(range, [
        { type: 'mention', attrs: { id: item.id, label: item.id, mentionSuggestionChar: char } },
        { type: 'text', text: ' ' },
      ]).run();
    },
    render: () => ({
      onStart: (p: any) => setMenu({ items: p.items, index: 0, rect: p.clientRect?.() ?? null, command: p.command }),
      onUpdate: (p: any) => setMenu((m) => ({ items: p.items, index: Math.min(m?.index ?? 0, Math.max(p.items.length - 1, 0)), rect: p.clientRect?.() ?? null, command: p.command })),
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        const m = menuRef.current;
        if (!m) return false;
        const n = Math.max(m.items.length, 1);
        if (event.key === 'ArrowDown') { setMenu({ ...m, index: (m.index + 1) % n }); return true; }
        if (event.key === 'ArrowUp') { setMenu({ ...m, index: (m.index - 1 + n) % n }); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { const it = m.items[m.index]; if (it) m.command(it); return true; }
        if (event.key === 'Escape') { setMenu(null); return true; }
        return false;
      },
      onExit: () => setMenu(null),
    }),
  });

  const editor = useEditor({
    immediatelyRender: false,
    content: toDoc(props.content),
    extensions: [
      Document, Paragraph, Text,
      Placeholder.configure({ placeholder: props.placeholder ?? 'Describe this step…' }),
      Mention.configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => (node.attrs.mentionSuggestionChar === '{{' ? `{{${node.attrs.id}}}` : `@${node.attrs.id}`),
        renderHTML: ({ node }) => {
          const isVar = node.attrs.mentionSuggestionChar === '{{';
          const known = isVar || live.current.actions.some((a) => a.key === node.attrs.id && a.enabled);
          return ['span', { class: `chip ${isVar ? 'chip-var' : known ? 'chip-action' : 'chip-missing'}` },
            isVar ? `{{${node.attrs.id}}}` : `@${node.attrs.id}`];
        },
        suggestions: [suggestion('@', 'actionMention'), suggestion('{{', 'varMention')],
      }),
    ],
    editorProps: {
      // Enter = new step, Backspace on empty = delete step; the open @ menu gets keys first.
      handleKeyDown: (view, event) => {
        if (menuRef.current) return false;
        if (event.key === 'Enter' && !event.shiftKey && live.current.onEnter) { event.preventDefault(); live.current.onEnter(); return true; }
        const empty = view.state.doc.childCount === 1 && view.state.doc.firstChild?.childCount === 0;
        if (event.key === 'Backspace' && empty && live.current.onBackspaceEmpty) { event.preventDefault(); live.current.onBackspaceEmpty(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => live.current.onChange(fromDoc(e.getJSON())),
  });

  useEffect(() => { if (props.autoFocus && editor) editor.commands.focus('end'); }, [props.autoFocus, editor]);

  return (
    <div className="step-editor relative w-full">
      <EditorContent editor={editor} />
      {/* Portalled to <body>: inside the canvas a CSS transform would make "fixed" relative to the zoomed canvas, not the screen. */}
      {menu && menu.rect && createPortal(
        <div className="fixed z-[1000] w-72 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-lg" style={menuPos(menu.rect, menu.items.length)}>
          {menu.items.length === 0 && <div className="px-3 py-2 text-sm text-ink-3">No matches</div>}
          {menu.items.map((it, i) => (
            <button key={it.id} type="button" onMouseDown={(e) => { e.preventDefault(); menu.command(it); }}
                    className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${i === menu.index ? 'bg-hover' : ''}`}>
              <span className={it.kind === 'condition' ? 'font-medium text-brand' : it.kind === 'var' ? 'text-var' : 'text-action'}>
                {it.kind === 'condition' ? '◇ Condition' : it.kind === 'var' ? `{{${it.label}}}` : `@${it.label}`}
              </span>
              <span className="truncate text-xs text-ink-3">{it.hint}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Below the cursor, or above it when there's no room; never past the screen's right edge.
function menuPos(r: DOMRect, count: number): React.CSSProperties {
  const height = Math.max(1, count) * 32 + 8;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 288 - 8));
  return r.bottom + 6 + height > window.innerHeight && r.top - 6 - height > 0
    ? { left, bottom: window.innerHeight - r.top + 6 }
    : { left, top: r.bottom + 6 };
}
