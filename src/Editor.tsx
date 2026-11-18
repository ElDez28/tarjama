import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fromEditable, numberNotes, pieces, toEditable } from './markers';
import type { Footnote, Segment } from './types';

interface Props {
  segments: Segment[];
  footnotes: Record<string, Footnote>;
  onChangeSegment: (id: string, bs: string, removedNotes: string[]) => void;
  onAddNote: (segmentId: string, offset: number, text: string) => void;
  onChangeNote: (id: string, text: string | null) => void;
}

interface NoteMenu {
  segmentId: string;
  offset: number;
  x: number;
  y: number;
  writing: boolean;
}

export function Editor({ segments, footnotes, onChangeSegment, onAddNote, onChangeNote }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<NoteMenu | null>(null);
  const [noteText, setNoteText] = useState('');
  const [openNote, setOpenNote] = useState<{ id: string; x: number; y: number } | null>(null);
  const numbers = useMemo(() => numberNotes(segments), [segments]);

  // text selection inside a Bosnian sentence → "Dodaj fusnotu"
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const end = range.endContainer;
      const span = (end.nodeType === 3 ? end.parentElement : (end as Element))?.closest<HTMLElement>('[data-start]');
      const cell = span?.closest<HTMLElement>('[data-seg]');
      if (!span || !cell) return;
      const seg = segments.find((s) => s.id === cell.dataset.seg);
      if (!seg) return;
      let offset = Number(span.dataset.start) + (end.nodeType === 3 ? range.endOffset : 0);
      // put the mark after the whole word, before punctuation that follows it
      while (offset < seg.bs.length && /[\p{L}\p{N}'’-]/u.test(seg.bs[offset])) offset++;
      const rect = range.getBoundingClientRect();
      setMenu({ segmentId: seg.id, offset, x: rect.left + rect.width / 2, y: rect.bottom + 6, writing: false });
      setNoteText('');
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [segments]);

  const saveNote = () => {
    if (menu && noteText.trim()) onAddNote(menu.segmentId, menu.offset, noteText.trim());
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  };

  if (!segments.length) return null;

  return (
    <div className="sheet" onMouseLeave={() => setHover(null)}>
      <div className="colheads">
        <div>Bosanski</div>
        <div dir="rtl">العربية</div>
      </div>
      {segments.map((s, i) => (
        <Row
          key={s.id}
          seg={s}
          newPage={i === 0 || segments[i - 1].page !== s.page}
          active={hover === s.id || editing === s.id}
          editing={editing === s.id}
          numbers={numbers}
          footnotes={footnotes}
          onHover={setHover}
          onEdit={(id) => {
            setMenu(null);
            setEditing(id);
          }}
          onDone={(bs, removed) => {
            if (bs !== null) onChangeSegment(s.id, bs, removed);
            setEditing(null);
          }}
          onOpenNote={(id, x, y) => setOpenNote({ id, x, y })}
        />
      ))}

      {menu && (
        <div className="popover" style={{ left: menu.x, top: menu.y }} onMouseUp={(e) => e.stopPropagation()}>
          {!menu.writing ? (
            <button className="btn small primary" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu({ ...menu, writing: true })}>
              Dodaj fusnotu
            </button>
          ) : (
            <div className="notebox">
              <textarea
                autoFocus
                rows={3}
                value={noteText}
                placeholder="Tekst fusnote…"
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote();
                  if (e.key === 'Escape') setMenu(null);
                }}
              />
              <div className="actions">
                <button className="btn small" onClick={() => setMenu(null)}>
                  Odustani
                </button>
                <button className="btn small primary" onClick={saveNote} disabled={!noteText.trim()}>
                  Dodaj
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {openNote && footnotes[openNote.id] && (
        <NoteEditor
          key={openNote.id}
          number={numbers.get(openNote.id) ?? 0}
          note={footnotes[openNote.id]}
          x={openNote.x}
          y={openNote.y}
          onClose={() => setOpenNote(null)}
          onSave={(text) => {
            onChangeNote(openNote.id, text);
            setOpenNote(null);
          }}
        />
      )}
    </div>
  );
}

interface RowProps {
  seg: Segment;
  newPage: boolean;
  active: boolean;
  editing: boolean;
  numbers: Map<string, number>;
  footnotes: Record<string, Footnote>;
  onHover: (id: string) => void;
  onEdit: (id: string) => void;
  onDone: (bs: string | null, removed: string[]) => void;
  onOpenNote: (id: string, x: number, y: number) => void;
}

const Row = memo(function Row({ seg, newPage, active, editing, numbers, footnotes, onHover, onEdit, onDone, onOpenNote }: RowProps) {
  const notesHere = pieces(seg.bs).filter((p) => p.kind === 'note');
  return (
    <>
      {newPage && (
        <div className="pagemark">
          <span>Arapska strana {seg.page}</span>
        </div>
      )}
      <div className={'seg' + (active ? ' active' : '') + (seg.paraStart ? ' para' : '') + (seg.heading ? ' heading' : '')} onMouseEnter={() => onHover(seg.id)}>
        <div className="bs" data-seg={seg.id}>
          {editing ? (
            <EditBox bs={seg.bs} numbers={numbers} onDone={onDone} />
          ) : (
            <div
              className={'bs-text' + (seg.bs ? '' : ' empty')}
              tabIndex={0}
              role="button"
              aria-label="Uredi prevod rečenice"
              onClick={(e) => {
                if (window.getSelection()?.isCollapsed === false) return; // selecting for a footnote
                if ((e.target as HTMLElement).closest('sup')) return;
                onEdit(seg.id);
              }}
              onKeyDown={(e) => e.key === 'Enter' && onEdit(seg.id)}
            >
              {seg.bs ? (
                pieces(seg.bs).map((p) =>
                  p.kind === 'text' ? (
                    <span key={p.start} data-start={p.start}>
                      {p.text}
                    </span>
                  ) : (
                    <sup
                      key={p.start}
                      className="fnref"
                      title={footnotes[p.id]?.text}
                      onClick={(e) => {
                        const r = (e.target as HTMLElement).getBoundingClientRect();
                        onOpenNote(p.id, r.left, r.bottom + 6);
                      }}
                    >
                      {numbers.get(p.id)}
                    </sup>
                  ),
                )
              ) : (
                <em>Nije prevedeno — klikni da upišeš prevod.</em>
              )}
            </div>
          )}
          {notesHere.length > 0 && !editing && (
            <ol className="fnlist">
              {notesHere.map((p) =>
                p.kind === 'note' && footnotes[p.id] ? (
                  <li key={p.id} value={numbers.get(p.id)}>
                    {footnotes[p.id].text}
                  </li>
                ) : null,
              )}
            </ol>
          )}
        </div>
        <div className="ar" dir="rtl" lang="ar">
          {seg.ar}
        </div>
      </div>
    </>
  );
});

function EditBox({ bs, numbers, onDone }: { bs: string; numbers: Map<string, number>; onDone: (bs: string | null, removed: string[]) => void }) {
  const initial = useMemo(() => toEditable(bs, numbers), [bs, numbers]);
  const [text, setText] = useState(initial.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }, [text]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!save || text === initial.text) return onDone(null, []);
    const { bs: out, removed } = fromEditable(text, initial.ids);
    if (removed.length && !confirm(`Obrisao si oznaku fusnote (${removed.length}). Obrisati i tu fusnotu?`)) {
      done.current = false;
      return;
    }
    onDone(out, removed);
  };

  return (
    <div className="editbox">
      <textarea
        ref={ref}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish(false);
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finish(true);
          }
        }}
      />
      <small className="muted">Enter sačuva · Esc odustane · ⁽¹⁾ je oznaka fusnote</small>
    </div>
  );
}

function NoteEditor({ number, note, x, y, onClose, onSave }: { number: number; note: Footnote; x: number; y: number; onClose: () => void; onSave: (t: string | null) => void }) {
  const [text, setText] = useState(note.text);
  return (
    <div className="overlay clear" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popover" style={{ left: x, top: y }}>
        <div className="notebox">
          <strong>
            Fusnota {number}
            {note.fromSource ? ' (iz arapske knjige)' : ''}
          </strong>
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="actions">
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm('Obrisati ovu fusnotu?')) onSave(null);
              }}
            >
              Obriši
            </button>
            <button className="btn small" onClick={onClose}>
              Odustani
            </button>
            <button className="btn small primary" onClick={() => onSave(text.trim())} disabled={!text.trim()}>
              Sačuvaj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
