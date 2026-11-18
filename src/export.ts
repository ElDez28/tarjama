import {
  AlignmentType,
  Document,
  Footer,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TableOfContents,
  TextRun,
} from 'docx';
// Paged.js (MIT) is copied to public/vendor, its package does not export the file
const pagedUrl = './vendor/paged.polyfill.min.js';
import serif400 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url';
import serif400x from '@fontsource/source-serif-4/files/source-serif-4-latin-ext-400-normal.woff2?url';
import serif400i from '@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2?url';
import serif400ix from '@fontsource/source-serif-4/files/source-serif-4-latin-ext-400-italic.woff2?url';
import serif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url';
import serif600x from '@fontsource/source-serif-4/files/source-serif-4-latin-ext-600-normal.woff2?url';
import amiri400 from '@fontsource/amiri/files/amiri-arabic-400-normal.woff2?url';
import { MARKER } from './markers';
import { downloadBlob } from './storage';
import type { Project } from './types';

/* ---------- the book as blocks ---------- */

type Run = { text: string } | { note: string };
interface Block {
  kind: 'h' | 'p';
  runs: Run[];
}

/** Joins sentences into paragraphs and headings, with footnotes in place. */
export function bookBlocks(p: Project): Block[] {
  const blocks: Block[] = [];
  for (const s of p.segments) {
    if (!s.bs.trim()) continue;
    const runs: Run[] = [];
    let last = 0;
    for (const m of s.bs.matchAll(MARKER)) {
      const i = m.index ?? 0;
      if (i > last) runs.push({ text: s.bs.slice(last, i) });
      if (p.footnotes[m[1]]) runs.push({ note: m[1] });
      last = i + m[0].length;
    }
    if (last < s.bs.length) runs.push({ text: s.bs.slice(last) });

    const prev = blocks[blocks.length - 1];
    if (s.heading) blocks.push({ kind: 'h', runs });
    else if (!prev || prev.kind === 'h' || s.paraStart) blocks.push({ kind: 'p', runs });
    else prev.runs.push({ text: ' ' }, ...runs);
  }
  // tidy spaces
  for (const b of blocks) for (const r of b.runs) if ('text' in r) r.text = r.text.replace(/\s+/g, ' ');
  return blocks;
}

const PAGE_MM: Record<Project['book']['size'], [number, number]> = { A5: [148, 210], B5: [176, 250], A4: [210, 297] };

/** Margins in mm for an A5 page (top, sides, bottom), scaled for bigger pages. */
const MARGINS = { narrow: [12, 12, 14], normal: [15, 15, 18], wide: [19, 18, 22] } as const;

export function marginsMm(book: Project['book']): { top: number; side: number; bottom: number } {
  const [t, sd, b] = MARGINS[book.margins ?? 'narrow'];
  const k = PAGE_MM[book.size][0] / 148;
  return { top: Math.round(t * k), side: Math.round(sd * k), bottom: Math.round(b * k) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- PDF: a paged book in a new window, then the browser's "Save as PDF" ---------- */

export function bookHtml(p: Project): string {
  const [w, h] = PAGE_MM[p.book.size];
  const blocks = bookBlocks(p);
  const headings = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.kind === 'h');
  const saw = (t: string) => t.replace(/ﷺ/g, '<span class="saw">ﷺ</span>');
  const runHtml = (r: Run) => ('text' in r ? saw(esc(r.text)) : `<span class="fn">${saw(esc(p.footnotes[r.note].text))}</span>`);
  const body = blocks
    .map((b, i) => (b.kind === 'h' ? `<h2 id="h${i}">${b.runs.map(runHtml).join('')}</h2>` : `<p>${b.runs.map(runHtml).join('').trim()}</p>`))
    .join('\n');
  const toc =
    headings.length > 1
      ? `<section class="toc"><h1>Sadržaj</h1><ul>${headings
          .map(({ b, i }) => `<li><a href="#h${i}" data-target="h${i}"><span>${b.runs.map((r) => ('text' in r ? esc(r.text) : '')).join('')}</span><span class="pg"></span></a></li>`)
          .join('')}</ul></section>`
      : '';
  const font = (url: string, weight: number, style = 'normal', range = '') =>
    `@font-face{font-family:'Book Serif';src:url(${new URL(url, location.href).href}) format('woff2');font-weight:${weight};font-style:${style};${range}}`;
  const latinExt = 'unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;';
  const size = p.book.fontSize;
  const m = marginsMm(p.book);

  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
${font(serif400, 400)}${font(serif400x, 400, 'normal', latinExt)}${font(serif400i, 400, 'italic')}${font(serif400ix, 400, 'italic', latinExt)}${font(serif600, 600)}${font(serif600x, 600, 'normal', latinExt)}
@font-face{font-family:'Book Arabic';src:url(${new URL(amiri400, location.href).href}) format('woff2');}
@page { size: ${w}mm ${h}mm; margin: ${m.top}mm ${m.side}mm ${m.bottom}mm;
  @bottom-center { content: counter(page); font: ${size - 1.5}pt 'Book Serif'; }
  @footnote { border-top: 0.5pt solid #000; padding-top: 2mm; margin-top: 3mm; }
}
@page :first { @bottom-center { content: none; } }
@page front { @bottom-center { content: none; } }
html { font-family: 'Book Serif', 'Book Arabic', serif; font-size: ${size}pt; line-height: 1.45; color: #000; }
.title { page: front; break-after: page; text-align: center; padding-top: 28%; }
.title h1 { font-size: 2.1em; font-weight: 600; margin: 0 0 0.6em; line-height: 1.2; }
.title .author { font-size: 1.2em; }
.title .translator { margin-top: 3em; font-style: italic; }
.toc { page: front; break-after: page; }
.toc h1 { font-size: 1.4em; font-weight: 600; text-align: center; margin-bottom: 1.2em; }
.toc ul { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0.35em 0; }
.toc a { color: inherit; text-decoration: none; display: flex; }
.toc .pg { margin-left: auto; padding-left: 1em; }
h2 { font-size: 1.25em; font-weight: 600; text-align: center; margin: 1.6em 0 0.9em; break-after: avoid; line-height: 1.25; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }
h2 + p { text-indent: 0; }
.saw { font-family: 'Book Arabic'; font-size: 1.3em; line-height: 0; }
.fn { float: footnote; font-size: 0.8em; line-height: 1.35; text-indent: 0; text-align: left; }
::footnote-call { font-size: 0.7em; vertical-align: super; line-height: 0; }
::footnote-marker { font-size: 0.9em; }
@media screen { body { background: #e8e4da; } .pagedjs_page { background: #fff; margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
</style>
<script>
window.PagedConfig = { auto: false };
async function layBook() {
  // the hint lives outside <body>, which Paged.js takes over
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.style.cssText = 'font-family:system-ui,sans-serif;position:fixed;top:8px;left:8px;right:8px;background:#1f3a5f;color:#fff;padding:10px 14px;border-radius:6px;z-index:99';
  hint.textContent = 'Slažem knjigu u stranice… Kod velike knjige ovo traje i do minute.';
  document.documentElement.appendChild(hint);
  try {
    await document.fonts.ready;
    const flow = await new Paged.Previewer().preview();
    // page numbers in the table of contents, read from the laid-out pages
    for (const a of document.querySelectorAll('.toc a[data-target]')) {
      const id = a.getAttribute('data-target');
      const target = document.querySelector('.pagedjs_pages [data-id="' + id + '"], .pagedjs_pages #' + id);
      const page = target && target.closest('.pagedjs_page');
      const pg = a.querySelector('.pg');
      if (page && pg) pg.textContent = page.getAttribute('data-page-number');
    }
    hint.textContent = 'Knjiga je složena (' + flow.total + ' strana). U prozoru za štampu izaberi „Sačuvaj kao PDF“.';
    document.documentElement.dataset.done = flow.total;
    window.addEventListener('beforeprint', () => (hint.style.display = 'none'));
    window.addEventListener('afterprint', () => (hint.style.display = ''));
    setTimeout(() => window.print(), 400);
  } catch (e) {
    hint.textContent = 'Slaganje knjige nije uspjelo: ' + e;
  }
}
</script>
<script src="${new URL(pagedUrl, location.href).href}"></script>
<script>window.addEventListener('load', layBook);</script>
</head><body>
<section class="title"><h1>${esc(p.title)}</h1>${p.book.author ? `<div class="author">${esc(p.book.author)}</div>` : ''}${
    p.book.translator ? `<div class="translator">Preveo s arapskog: ${esc(p.book.translator)}</div>` : ''
  }</section>
${toc}
<main>${body}</main>
</body></html>`;
}

export function exportPdf(p: Project): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(bookHtml(p));
  w.document.close();
  return true;
}

/* ---------- Word (.docx) with real Word footnotes ---------- */

export async function exportDocx(p: Project, download = true): Promise<Blob> {
  const [wmm, hmm] = PAGE_MM[p.book.size];
  const mg = marginsMm(p.book);
  const twip = (mm: number) => Math.round((mm / 25.4) * 1440);
  const blocks = bookBlocks(p);
  const notes: Record<number, { children: Paragraph[] }> = {};
  let n = 0;
  const half = p.book.fontSize * 2;

  const runs = (b: Block) =>
    b.runs.map((r) => {
      if ('text' in r) return new TextRun({ text: r.text });
      n += 1;
      notes[n] = { children: [new Paragraph({ children: [new TextRun({ text: p.footnotes[r.note].text, size: Math.round(half * 0.8) })] })] };
      return new FootnoteReferenceRun(n);
    });

  const content: Paragraph[] = [];
  let afterHeading = true;
  for (const b of blocks) {
    if (b.kind === 'h') {
      content.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 360, after: 200 }, children: runs(b) }));
      afterHeading = true;
    } else {
      content.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: afterHeading ? undefined : { firstLine: 400 }, children: runs(b) }));
      afterHeading = false;
    }
  }

  const front: Paragraph[] = [
    new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.title, bold: true, size: half * 2 })] }),
    ...(p.book.author ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 300 }, children: [new TextRun({ text: p.book.author, size: Math.round(half * 1.2) })] })] : []),
    ...(p.book.translator
      ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900 }, children: [new TextRun({ text: 'Preveo s arapskog: ' + p.book.translator, italics: true })] })]
      : []),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  const hasToc = blocks.filter((b) => b.kind === 'h').length > 1;

  const doc = new Document({
    creator: 'Tarjama',
    title: p.title,
    features: { updateFields: hasToc },
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: half }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: Math.round(half * 1.25), color: '000000' } },
      ],
    },
    footnotes: notes,
    sections: [
      {
        properties: {
          page: {
            size: { width: twip(wmm), height: twip(hmm) },
            margin: { top: twip(mg.top), bottom: twip(mg.bottom), left: twip(mg.side), right: twip(mg.side), footer: twip(mg.bottom * 0.45) },
          },
          titlePage: true,
        },
        footers: {
          default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }),
          first: new Footer({ children: [] }),
        },
        children: [
          ...front,
          ...(hasToc
            ? [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Sadržaj', bold: true, size: Math.round(half * 1.3) })] }),
                new TableOfContents('Sadržaj', { hyperlink: true, headingStyleRange: '1-1' }),
                new Paragraph({ children: [new PageBreak()] }),
              ]
            : []),
          ...content,
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  if (download) downloadBlob(blob, safeName(p.title) + '.docx');
  return blob;
}

/* ---------- plain text, for pasting anywhere ---------- */

export function exportTxt(p: Project) {
  const blocks = bookBlocks(p);
  let n = 0;
  const notes: string[] = [];
  const text = blocks
    .map((b) => {
      const t = b.runs
        .map((r) => {
          if ('text' in r) return r.text;
          n += 1;
          notes.push(`[${n}] ${p.footnotes[r.note].text}`);
          return `[${n}]`;
        })
        .join('')
        .trim();
      return b.kind === 'h' ? `\n${t.toUpperCase()}\n` : t;
    })
    .join('\n\n');
  const out = `${p.title}\n\n${text}\n\n${notes.length ? '— Fusnote —\n\n' + notes.join('\n') : ''}\n`;
  downloadBlob(new Blob([out], { type: 'text/plain;charset=utf-8' }), safeName(p.title) + '.txt');
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'prevod';
