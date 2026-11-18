import { useEffect, useState } from 'react';
import { openPdf, readTextPage, renderPreviewUrl, type PdfDoc } from './pdf';
import {
  ensurePermission,
  fileApiSupported,
  forgetRecent,
  hashBytes,
  listRecent,
  loadBackup,
  pickOpenFile,
  pickSaveFile,
  readProjectFile,
  savePdf,
  writeProjectFile,
  type RecentEntry,
} from './storage';
import { DEFAULT_RULES } from './translate';
import type { Project, ReadMode } from './types';

export interface Opened {
  project: Project;
  handle?: FileSystemFileHandle;
  doc?: PdfDoc;
}

interface Pending {
  bytes: ArrayBuffer;
  doc: PdfDoc;
  name: string;
  hash: string;
  preview: string;
  sampleText: string;
  samplePage: number;
  scanned: boolean;
}

export function Home({ onOpen }: { onOpen: (o: Opened) => void }) {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRecent().then(setRecent);
  }, []);

  const choosePdf = async (file: File) => {
    setError(null);
    setBusy('Otvaram PDF…');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await openPdf(bytes);
      const hash = await hashBytes(bytes);
      // find a page with real text among the first ones, to show how the text layer looks
      let best = { n: 1, chars: -1, text: '' };
      for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
        const p = await readTextPage(doc, n);
        if (p.arabicChars > best.chars) best = { n, chars: p.arabicChars, text: p.paras.join('\n\n') };
        if (p.arabicChars > 600) break;
      }
      if (best.chars < 40) best.n = Math.min(doc.numPages, 9); // show a text page, not the cover
      const preview = await renderPreviewUrl(doc, best.n);
      setPending({
        bytes,
        doc,
        name: file.name,
        hash,
        preview,
        sampleText: best.text.slice(0, 1800),
        samplePage: best.n,
        scanned: best.chars < 40,
      });
      setTitle(file.name.replace(/\.pdf$/i, ''));
    } catch (e) {
      setError('Ovaj PDF se ne može otvoriti: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = async (readMode: ReadMode) => {
    if (!pending) return;
    const now = new Date().toISOString();
    const project: Project = {
      format: 'tarjama',
      version: 1,
      id: crypto.randomUUID(),
      title: title.trim() || pending.name,
      createdAt: now,
      updatedAt: now,
      pdf: { name: pending.name, size: pending.bytes.byteLength, hash: pending.hash, pageCount: pending.doc.numPages },
      readMode,
      pages: new Array(pending.doc.numPages).fill(null),
      translatedPages: 0,
      segments: [],
      footnotes: {},
      rules: DEFAULT_RULES,
      book: { size: 'A5', fontSize: 11, author: '', translator: '' },
    };
    let handle: FileSystemFileHandle | undefined;
    if (fileApiSupported) {
      try {
        handle = await pickSaveFile(project.title);
        await writeProjectFile(handle, project);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // the user closed the save window
        setError('Fajl nije sačuvan: ' + (e as Error).message);
        return;
      }
    }
    await savePdf(pending.hash, pending.bytes);
    onOpen({ project, handle, doc: pending.doc });
  };

  const openRecent = async (r: RecentEntry) => {
    setError(null);
    try {
      if (r.handle) {
        if (!(await ensurePermission(r.handle))) return;
        onOpen({ project: await readProjectFile(r.handle), handle: r.handle });
      } else {
        const p = await loadBackup(r.id);
        if (!p) throw new Error('Kopija u browseru više ne postoji.');
        onOpen({ project: p });
      }
    } catch (e) {
      const backup = await loadBackup(r.id);
      if (backup && confirm(`Fajl "${r.fileName}" se ne može otvoriti (${(e as Error).message}). Otvoriti rezervnu kopiju iz browsera?`)) {
        onOpen({ project: backup });
      } else setError('Projekat se ne može otvoriti: ' + (e as Error).message);
    }
  };

  const openFile = async () => {
    setError(null);
    try {
      const h = await pickOpenFile();
      if (!(await ensurePermission(h))) return;
      onOpen({ project: await readProjectFile(h), handle: h });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Projekat se ne može otvoriti: ' + (e as Error).message);
    }
  };

  if (pending) {
    return (
      <main className="home">
        <h1>Nova knjiga</h1>
        <label className="field">
          <span>Naslov prevoda</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <p className="muted">
          {pending.name} · {pending.doc.numPages} strana
        </p>
        {pending.scanned ? (
          <>
            <p className="note">
              Iz ovog PDF-a se tekst ne može izvući (knjiga je skenirana ili su fontovi bez slova u sebi), pa će AI čitati svaku stranicu sa slike. To traje malo duže i košta
              otprilike duplo.
            </p>
            <img className="single" src={pending.preview} alt={`Stranica ${pending.samplePage}`} />
            <div className="actions">
              <button className="btn" onClick={() => setPending(null)}>
                Nazad
              </button>
              <button className="btn primary" onClick={() => create('vision')}>
                Napravi projekat
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Lijevo je stranica {pending.samplePage} iz PDF-a, desno tekst koji je aplikacija iz nje pročitala. <strong>Je li tekst desno isti kao na slici?</strong> (iste
              riječi, istim redom, bez ispremetanih slova)
            </p>
            <div className="compare">
              <img src={pending.preview} alt={`Stranica ${pending.samplePage}`} />
              <div className="ar sample" dir="rtl" lang="ar">
                {pending.sampleText || '—'}
              </div>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setPending(null)}>
                Nazad
              </button>
              <button className="btn" onClick={() => create('vision')}>
                Nije isti, neka AI čita stranice
              </button>
              <button className="btn primary" onClick={() => create('text')}>
                Isti je, koristi ovaj tekst
              </button>
            </div>
          </>
        )}
        {!fileApiSupported && <p className="error">Ovaj browser ne može snimati projekat u fajl. Koristi Chrome ili Edge.</p>}
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="home">
      <header className="brand">
        <h1>Tarjama</h1>
        <p className="muted">Prevod arapskih knjiga na bosanski, rečenicu po rečenicu, do gotove knjige.</p>
      </header>

      <div className="start">
        <label className={'btn primary big' + (busy ? ' disabled' : '')}>
          {busy ?? 'Nova knjiga iz PDF-a'}
          <input type="file" accept="application/pdf" hidden disabled={!!busy} onChange={(e) => e.target.files?.[0] && choosePdf(e.target.files[0])} />
        </label>
        {fileApiSupported && (
          <button className="btn big" onClick={openFile}>
            Otvori projekat (.tarjama)
          </button>
        )}
      </div>
      {!fileApiSupported && <p className="error">Ovaj browser ne može snimati projekat u fajl na računaru. Otvori aplikaciju u Chromeu ili Edgeu.</p>}
      {error && <p className="error">{error}</p>}

      {recent.length > 0 && (
        <section>
          <h2>Zadnje knjige</h2>
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => openRecent(r)}>
                  <strong>{r.title}</strong>
                  <span className="muted">
                    {r.fileName} · {new Date(r.updatedAt).toLocaleString('bs-BA')}
                  </span>
                </button>
                <button
                  className="icon"
                  title="Ukloni sa liste (fajl ostaje na računaru)"
                  aria-label="Ukloni sa liste"
                  onClick={async () => {
                    await forgetRecent(r.id);
                    setRecent(await listRecent());
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
