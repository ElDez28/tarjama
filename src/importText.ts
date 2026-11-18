import mammoth from 'mammoth';
import type { SourcePage } from './types';

/**
 * Word and plain-text books have no pages, so the text is cut into parts of
 * about one book page. Each part is a SourcePage; the editor calls it "Dio".
 */
const WORDS_PER_PART = 260;

interface Para {
  text: string;
  heading: boolean;
  /** footnote numbers referenced in this paragraph */
  refs: number[];
}

function toParts(paras: Para[], notes: Map<number, string>): SourcePage[] {
  const parts: SourcePage[] = [];
  let cur: SourcePage | null = null;
  let words = 0;
  for (const p of paras) {
    const w = p.text.split(/\s+/).length;
    // start a new part before a heading or when the part is full
    if (!cur || (cur.paras.length && (words + w > WORDS_PER_PART * 1.25 || (p.heading && words > WORDS_PER_PART * 0.4)))) {
      cur = { n: parts.length + 1, paras: [], notes: [], headings: [], source: 'text' };
      parts.push(cur);
      words = 0;
    }
    if (p.heading) cur.headings!.push(cur.paras.length);
    cur.paras.push(p.text);
    for (const r of p.refs) {
      const t = notes.get(r);
      if (t) cur.notes.push(`(${r}) ${t}`);
    }
    words += w;
  }
  return parts;
}

const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

export async function readDocx(bytes: ArrayBuffer): Promise<SourcePage[]> {
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: bytes });
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // footnotes and endnotes are listed at the end as <li id="footnote-N"> / <li id="endnote-N">
  const notes = new Map<number, string>();
  const noteNum = new Map<string, number>();
  let counter = 0;
  for (const li of doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]')) {
    li.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((a) => a.remove());
    const n = ++counter;
    noteNum.set(li.id, n);
    notes.set(n, clean(li.textContent ?? ''));
    li.closest('ol')?.setAttribute('data-notes', '1');
  }

  const paras: Para[] = [];
  for (const el of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    if (el.closest('ol[data-notes]')) continue;
    if (el.tagName === 'LI' && el.querySelector('p')) continue; // its <p> children are taken instead
    const refs: number[] = [];
    el.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]').forEach((a) => {
      const n = noteNum.get((a.getAttribute('href') ?? '').slice(1));
      const sup = a.closest('sup') ?? a;
      if (n) {
        refs.push(n);
        sup.replaceWith(` (${n}) `);
      } else sup.remove();
    });
    const text = clean(el.textContent ?? '');
    if (!text) continue;
    paras.push({ text, heading: /^H\d$/.test(el.tagName), refs });
  }
  if (!paras.length) throw new Error('U ovom Word fajlu nema teksta.');
  return toParts(paras, notes);
}

export function readTxt(text: string): SourcePage[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  // a file with single line breaks only: every line is a paragraph
  const lines = blocks.length < 3 ? text.split(/\n/) : blocks;
  const paras: Para[] = lines.map((b) => ({ text: clean(b), heading: false, refs: [] })).filter((p) => p.text);
  if (!paras.length) throw new Error('Fajl je prazan.');
  return toParts(paras, new Map());
}
