import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SourcePage } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function openPdf(bytes: ArrayBuffer): Promise<PdfDoc> {
  // pdf.js takes ownership of the buffer it gets, so give it a copy.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const ARABIC_DIGITS_ONLY = /^[\s\d٠-٩۰-۹()[\]\-–—.]*$/;

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Line {
  y: number;
  h: number;
  left: number;
  right: number;
  text: string;
}

/**
 * Reads a page's text layer. Arabic books are right to left: items on a line
 * are ordered by x from the right. Presentation forms (ﻻ, ﺑ…) are folded to
 * normal letters with NFKC. Smaller text in the lower part of the page is
 * taken as the page's footnotes; lines with only a number at the very top or
 * bottom are page numbers and are dropped.
 */
export async function readTextPage(doc: PdfDoc, n: number): Promise<SourcePage & { arabicChars: number }> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: Item[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [, , , d, e, f] = it.transform as number[];
    items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, h: Math.abs(d) || it.height });
  }

  // group into lines by baseline
  items.sort((a, b) => a.y - b.y);
  const lines: { y: number; h: number; items: Item[] }[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, Math.min(last.h, it.h) * 0.45)) {
      last.items.push(it);
      last.h = Math.max(last.h, it.h);
    } else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  const built: Line[] = lines.map((l) => {
    const sorted = [...l.items].sort((a, b) => b.x - a.x);
    let text = '';
    let prevLeft: number | null = null;
    for (const it of sorted) {
      const right = it.x + it.w;
      if (prevLeft !== null && prevLeft - right > it.h * 0.15 && !text.endsWith(' ')) text += ' ';
      text += it.str;
      prevLeft = it.x;
    }
    return {
      y: l.y,
      h: l.h,
      left: Math.min(...l.items.map((i) => i.x)),
      right: Math.max(...l.items.map((i) => i.x + i.w)),
      text: text.normalize('NFKC').replace(/\s+/g, ' ').trim(),
    };
  });

  const kept = built.filter((l, i) => {
    const edge = i === 0 || i === built.length - 1;
    return !(edge && ARABIC_DIGITS_ONLY.test(l.text));
  });

  const heights = kept.map((l) => l.h).sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || 10;
  // footnotes: the first small line in the lower 45% of the page that starts a run of small lines to the end
  let noteStart = kept.length;
  for (let i = kept.length - 1; i >= 0; i--) {
    const l = kept[i];
    if (l.h < bodyH * 0.88 && l.y > vp.height * 0.55) noteStart = i;
    else break;
  }
  const body = kept.slice(0, noteStart);
  const noteLines = kept.slice(noteStart);

  // paragraphs: a line clearly shorter than the full width ends a paragraph
  // (right-to-left justified text: the short line keeps the right edge and stops early on the left)
  const minLeft = Math.min(...body.map((l) => l.left));
  const maxRight = Math.max(...body.map((l) => l.right));
  const width = maxRight - minLeft || 1;
  const paras: string[] = [];
  let cur = '';
  body.forEach((l, i) => {
    const next = body[i + 1];
    cur = cur ? cur + ' ' + l.text : l.text;
    const short = l.left - minLeft > width * 0.12;
    const gap = next ? next.y - l.y > l.h * 2.1 : true;
    const centered = l.right < maxRight - width * 0.08 && short; // headings are often centred
    if (short || gap || centered) {
      paras.push(cur);
      cur = '';
    }
  });
  if (cur) paras.push(cur);

  // footnotes: a line starting with a number (1) / ١ starts a new note
  const notes: string[] = [];
  for (const l of noteLines) {
    if (/^[()[\]]?[\d٠-٩]+[()[\]]?[\s\-–.]/.test(l.text) || notes.length === 0) notes.push(l.text);
    else notes[notes.length - 1] += ' ' + l.text;
  }

  // Some PDFs give right-to-left text with brackets left unmirrored: ")١(" instead of "(١)".
  const all0 = paras.join(' ') + notes.join(' ');
  const flipped = (all0.match(/\)[^()]{1,8}\(/g) || []).length > (all0.match(/\([^()]{1,8}\)/g) || []).length;
  const mirror = (s: string) => (flipped ? s.replace(/[()[\]«»]/g, (c) => ({ '(': ')', ')': '(', '[': ']', ']': '[', '«': '»', '»': '«' })[c]!) : s);
  const fixedParas = paras.map(mirror);
  const fixedNotes = notes.map(mirror);
  const all = fixedParas.join(' ') + fixedNotes.join(' ');
  return { n, paras: fixedParas, notes: fixedNotes, source: 'text', arabicChars: (all.match(ARABIC) || []).length };
}

/** Renders a page to a PNG (base64, no prefix) for an AI model to read. */
export async function renderPagePng(doc: PdfDoc, n: number, maxSide = 1600): Promise<string> {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = maxSide / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 'print' renders without requestAnimationFrame, so it keeps going in a background tab
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return canvas.toDataURL('image/png').split(',')[1];
}

/** Smaller preview image for the import screen. */
export async function renderPreviewUrl(doc: PdfDoc, n: number): Promise<string> {
  return 'data:image/png;base64,' + (await renderPagePng(doc, n, 900));
}
