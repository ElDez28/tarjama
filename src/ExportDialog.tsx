import { useState } from 'react';
import { exportDocx, exportPdf, exportTxt } from './export';
import type { BookSettings, Project } from './types';

export function ExportDialog({ project, onBook, onClose }: { project: Project; onBook: (b: BookSettings) => void; onClose: () => void }) {
  const [b, setB] = useState<BookSettings>(project.book);
  const [msg, setMsg] = useState<string | null>(null);
  const p = { ...project, book: b };
  const untranslated = project.segments.filter((s) => !s.bs.trim()).length;
  const unfinished = project.translatedPages < project.pdf.pageCount;

  const run = async (fn: () => unknown) => {
    onBook(b);
    setMsg(null);
    try {
      const r = await fn();
      if (r === false) setMsg('Browser je blokirao novi prozor. Dozvoli iskačuće prozore za ovu stranicu i probaj ponovo.');
    } catch (e) {
      setMsg('Izvoz nije uspio: ' + (e as Error).message);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2>Izvoz knjige</h2>
        {(unfinished || untranslated > 0) && (
          <p className="note">
            {unfinished && `Prevedeno je ${project.translatedPages} od ${project.pdf.pageCount} strana. `}
            {untranslated > 0 && `${untranslated} rečenica nema prevod i neće biti u knjizi.`}
          </p>
        )}
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span>Format stranice</span>
            <select value={b.size} onChange={(e) => setB({ ...b, size: e.target.value as BookSettings['size'] })}>
              <option value="A5">A5 (148 × 210 mm, obična knjiga)</option>
              <option value="B5">B5 (176 × 250 mm)</option>
              <option value="A4">A4 (210 × 297 mm)</option>
            </select>
          </label>
          <label className="field" style={{ width: 130 }}>
            <span>Veličina slova</span>
            <select value={b.fontSize} onChange={(e) => setB({ ...b, fontSize: Number(e.target.value) })}>
              {[9, 10, 10.5, 11, 11.5, 12, 13, 14].map((n) => (
                <option key={n} value={n}>
                  {n} pt
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Autor knjige</span>
          <input value={b.author} onChange={(e) => setB({ ...b, author: e.target.value })} placeholder="npr. Abdulgani el-Makdisi" />
        </label>
        <label className="field">
          <span>Prevodilac</span>
          <input value={b.translator} onChange={(e) => setB({ ...b, translator: e.target.value })} />
        </label>
        <p className="muted">
          Knjiga dobija naslovnu stranu, sadržaj (ako ima naslova poglavlja), brojeve stranica i fusnote na dnu stranice. Brojevi stranica su novi, ne kao u arapskoj knjizi.
        </p>
        {msg && <p className="error">{msg}</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Zatvori
          </button>
          <button className="btn" onClick={() => run(() => exportTxt(p))}>
            Tekst (.txt)
          </button>
          <button className="btn" onClick={() => run(() => exportDocx(p))}>
            Word (.docx)
          </button>
          <button className="btn primary" onClick={() => run(() => exportPdf(p))}>
            PDF knjiga
          </button>
        </div>
      </div>
    </div>
  );
}
