import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from './Editor';
import { Home, type Opened } from './Home';
import { Settings } from './Settings';
import { MARKER } from './markers';
import { openPdf, type PdfDoc } from './pdf';
import { backupProject, downloadBlob, fileApiSupported, hashBytes, loadAi, loadPdf, pickSaveFile, rememberRecent, saveAi, savePdf, writeProjectFile } from './storage';
import { runTranslation, type JobProgress } from './translate';
import type { AiSettings, Project } from './types';
import { PROVIDERS } from './ai';
import { ExportDialog } from './ExportDialog';

type SaveState = 'saved' | 'saving' | 'error' | 'browser-only';

export default function App() {
  const [ai, setAi] = useState<AiSettings>(loadAi);
  const [showSettings, setShowSettings] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);

  const open = (o: Opened) => setOpened(o);

  return (
    <>
      {opened ? (
        <Workspace key={opened.project.id} opened={opened} ai={ai} onClose={() => setOpened(null)} onSettings={() => setShowSettings(true)} />
      ) : (
        <>
          <div className="topbar">
            <span />
            <button className="btn" onClick={() => setShowSettings(true)}>
              AI: {PROVIDERS.find((p) => p.id === ai.provider)?.name} {ai.apiKey || ai.provider === 'demo' ? '' : '(nema ključa)'}
            </button>
          </div>
          <Home onOpen={open} />
        </>
      )}
      {showSettings && (
        <Settings
          value={ai}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            saveAi(s);
            setAi(s);
            setShowSettings(false);
          }}
        />
      )}
    </>
  );
}

let noteCounter = Date.now() % 1e6;

function Workspace({ opened, ai, onClose, onSettings }: { opened: Opened; ai: AiSettings; onClose: () => void; onSettings: () => void }) {
  const [project, setProject] = useState<Project>(opened.project);
  const [handle, setHandle] = useState<FileSystemFileHandle | undefined>(opened.handle);
  const [warning, setWarning] = useState<string | undefined>(opened.warning);
  const [save, setSave] = useState<SaveState>(opened.handle ? 'saved' : 'browser-only');
  const [job, setJob] = useState<JobProgress | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const docRef = useRef<PdfDoc | undefined>(opened.doc);
  const abortRef = useRef<AbortController | null>(null);
  const latest = useRef(project);
  const timer = useRef<number | undefined>(undefined);
  const pdfInput = useRef<HTMLInputElement>(null);

  /* ---------- saving: file on disk + copy in the browser ---------- */

  const flush = useCallback(async () => {
    const p = latest.current;
    await backupProject(p.id, p);
    if (!handle) return;
    setSave('saving');
    try {
      await writeProjectFile(handle, p);
      setSave('saved');
    } catch {
      setSave('error');
      setWarning('Snimanje u fajl nije uspjelo. Rad je sačuvan u browseru; klikni „Kopija“ ili pokušaj ponovo sačuvati u fajl.');
    }
  }, [handle]);

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setProject((prev) => {
        const next = { ...fn(prev), updatedAt: new Date().toISOString() };
        latest.current = next;
        return next;
      });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 700);
    },
    [flush],
  );

  useEffect(() => {
    rememberRecent({ id: project.id, title: project.title, fileName: handle?.name ?? '(samo u browseru)', updatedAt: project.updatedAt, handle });
  }, [project.id, project.title, project.updatedAt, handle]);

  const saveToFile = async () => {
    try {
      const h = await pickSaveFile(latest.current.title);
      await writeProjectFile(h, latest.current);
      setHandle(h);
      setSave('saved');
      setWarning(undefined);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setWarning('Ni sada nije dozvoljeno snimanje u fajl (' + (e as Error).message + '). Otvori aplikaciju u Google Chromeu ili Microsoft Edgeu.');
    }
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (abortRef.current || save === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------- translation job ---------- */

  const ensureDoc = async (): Promise<PdfDoc | null> => {
    if (docRef.current) return docRef.current;
    const bytes = await loadPdf(project.pdf.hash);
    if (bytes) {
      docRef.current = await openPdf(bytes);
      return docRef.current;
    }
    pdfInput.current?.click();
    return null;
  };

  const attachPdf = async (file: File) => {
    const bytes = await file.arrayBuffer();
    if ((await hashBytes(bytes)) !== project.pdf.hash) {
      setJobError(`To nije isti PDF. Ovaj projekat je napravljen od fajla "${project.pdf.name}".`);
      return;
    }
    await savePdf(project.pdf.hash, bytes);
    docRef.current = await openPdf(bytes);
    start();
  };

  const start = async () => {
    setJobError(null);
    if (ai.provider !== 'demo' && !ai.apiKey && ai.provider !== 'compatible') {
      onSettings();
      return;
    }
    const fromPdf = (project.pdf.kind ?? 'pdf') === 'pdf';
    const doc = fromPdf ? await ensureDoc() : null;
    if (fromPdf && !doc) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ phase: 'reading', page: project.translatedPages + 1, total: project.pdf.pageCount });
    try {
      await runTranslation(
        latest.current,
        doc,
        ai,
        (p) => update((cur) => ({ ...cur, pages: p.pages, segments: mergeSegments(cur, p), footnotes: { ...p.footnotes, ...cur.footnotes }, translatedPages: p.translatedPages })),
        setJob,
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setJobError((e as Error).message);
    } finally {
      abortRef.current = null;
      setJob(null);
      flush();
    }
  };

  const stop = () => abortRef.current?.abort();

  /* ---------- edits ---------- */

  const changeSegment = (id: string, bs: string, removed: string[]) =>
    update((p) => {
      const fn = { ...p.footnotes };
      for (const r of removed) delete fn[r];
      return { ...p, footnotes: fn, segments: p.segments.map((s) => (s.id === id ? { ...s, bs, edited: true } : s)) };
    });

  const addNote = (segmentId: string, offset: number, text: string) =>
    update((p) => {
      const id = 'n' + (noteCounter++).toString(36);
      return {
        ...p,
        footnotes: { ...p.footnotes, [id]: { id, text } },
        segments: p.segments.map((s) => (s.id === segmentId ? { ...s, bs: s.bs.slice(0, offset) + `[^${id}]` + s.bs.slice(offset), edited: true } : s)),
      };
    });

  const changeNote = (id: string, text: string | null) =>
    update((p) => {
      const fn = { ...p.footnotes };
      if (text === null) {
        delete fn[id];
        return { ...p, footnotes: fn, segments: p.segments.map((s) => (s.bs.includes(`[^${id}]`) ? { ...s, bs: s.bs.replace(`[^${id}]`, '') } : s)) };
      }
      fn[id] = { ...fn[id], text };
      return { ...p, footnotes: fn };
    });

  const fromPdfBook = (project.pdf.kind ?? 'pdf') === 'pdf';
  const unit = fromPdfBook ? 'strana' : 'dijelova';
  const pct = Math.round((project.translatedPages / project.pdf.pageCount) * 100);
  const done = project.translatedPages >= project.pdf.pageCount;
  const words = project.segments.reduce((n, s) => n + (s.bs ? s.bs.replace(MARKER, '').split(/\s+/).length : 0), 0);

  return (
    <div className="workspace">
      <header className="bar">
        <button className="btn" onClick={() => (abortRef.current ? alert('Prvo zaustavi prevod.') : onClose())} title="Nazad na listu knjiga">
          ←
        </button>
        <input className="title" value={project.title} onChange={(e) => update((p) => ({ ...p, title: e.target.value }))} aria-label="Naslov knjige" />
        <div className="progress" title={`${project.translatedPages} od ${project.pdf.pageCount} strana`}>
          <div style={{ width: pct + '%' }} />
          <span>
            {project.translatedPages}/{project.pdf.pageCount} {unit} · {words.toLocaleString('bs-BA')} riječi
          </span>
        </div>
        {job ? (
          <button className="btn danger" onClick={stop}>
            Zaustavi
          </button>
        ) : (
          !done && (
            <button className="btn primary" onClick={start}>
              {project.translatedPages ? 'Nastavi prevod' : 'Počni prevod'}
            </button>
          )
        )}
        <button className="btn" onClick={() => setShowExport(true)} disabled={!project.segments.length}>
          Izvoz knjige
        </button>
        <button className="btn" onClick={() => setShowRules(true)}>
          Pravila prevoda
        </button>
        <button className="btn" onClick={onSettings}>
          AI
        </button>
        <button className="btn" onClick={() => downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), project.title + '.tarjama')} title="Preuzmi kopiju projekta">
          Kopija
        </button>
        <span className={'save ' + save}>
          {save === 'saved' ? 'Sačuvano' : save === 'saving' ? 'Snimam…' : save === 'error' ? 'Greška pri snimanju!' : 'Samo u browseru'}
        </span>
      </header>

      {job && (
        <div className="status">
          {job.phase === 'reading' && `Čitam stranu ${job.page} od ${job.total}…`}
          {job.phase === 'translating' && `Prevodim od ${fromPdfBook ? 'strane' : 'dijela'} ${job.page}…`}
          {job.phase === 'waiting' && job.message}
        </div>
      )}
      {warning && (
        <div className="status warn">
          {warning}{' '}
          {fileApiSupported && (
            <button className="btn small" onClick={saveToFile}>
              Pokušaj sačuvati u fajl
            </button>
          )}
        </div>
      )}
      {jobError && (
        <div className="status error">
          {jobError}{' '}
          <button className="btn small" onClick={() => setJobError(null)}>
            U redu
          </button>
        </div>
      )}

      <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && attachPdf(e.target.files[0])} />

      {project.segments.length === 0 && !job ? (
        <div className="empty-state">
          <p>
            Knjiga ima {project.pdf.pageCount} {unit}. Klikni <strong>Počni prevod</strong>. Prevod ide po {fromPdfBook ? 'dvije strane' : 'dva dijela'}, i sve se odmah snima, pa možeš zaustaviti i nastaviti
            kad hoćeš.
          </p>
          <p className="muted">Prije toga možeš pogledati „Pravila prevoda“: tu upisuješ kako da AI prevodi određene izraze.</p>
        </div>
      ) : (
        <Editor partLabel={fromPdfBook ? 'Arapska strana' : 'Dio'} segments={project.segments} footnotes={project.footnotes} onChangeSegment={changeSegment} onAddNote={addNote} onChangeNote={changeNote} />
      )}

      {showExport && <ExportDialog project={project} onBook={(book) => update((p) => ({ ...p, book }))} onClose={() => setShowExport(false)} />}
      {showRules && <RulesDialog value={project.rules} onClose={() => setShowRules(false)} onSave={(rules) => (update((p) => ({ ...p, rules })), setShowRules(false))} />}
    </div>
  );
}

/** The job works on a snapshot; edits the user made meanwhile must win. */
function mergeSegments(cur: Project, fromJob: Project) {
  const known = new Set(cur.segments.map((s) => s.id));
  return [...cur.segments, ...fromJob.segments.filter((s) => !known.has(s.id))];
}

function RulesDialog({ value, onClose, onSave }: { value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide">
        <h2>Pravila prevoda</h2>
        <p className="muted">AI ih dobija uz svaki dio knjige. Piši ih obično, jedno pravilo u red. Vrijede za ono što se prevodi od sada.</p>
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Odustani
          </button>
          <button className="btn primary" onClick={() => onSave(text)}>
            Sačuvaj
          </button>
        </div>
      </div>
    </div>
  );
}
