import type { Segment } from './types';

/** Footnote markers live inside the Bosnian text as [^id]. */
export const MARKER = /\[\^([a-z0-9]+)\]/g;

export type Piece = { kind: 'text'; text: string; start: number } | { kind: 'note'; id: string; start: number; end: number };

export function pieces(bs: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of bs.matchAll(MARKER)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: bs.slice(last, i), start: last });
    out.push({ kind: 'note', id: m[1], start: i, end: i + m[0].length });
    last = i + m[0].length;
  }
  if (last < bs.length) out.push({ kind: 'text', text: bs.slice(last), start: last });
  return out;
}

/** Footnote numbers in reading order across the whole book. */
export function numberNotes(segments: Segment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of segments) for (const m of s.bs.matchAll(MARKER)) if (!map.has(m[1])) map.set(m[1], map.size + 1);
  return map;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const toSup = (n: number) => String(n).split('').map((d) => SUP[Number(d)]).join('');
const fromSup = (s: string) => Number(s.split('').map((c) => SUP.indexOf(c)).join(''));

/** For the edit box: [^f3k] becomes ⁽¹²⁾ so the translator sees the number and cannot break the id. */
export function toEditable(bs: string, numbers: Map<string, number>): { text: string; ids: Map<number, string> } {
  const ids = new Map<number, string>();
  const text = bs.replace(MARKER, (_, id) => {
    const n = numbers.get(id) ?? 0;
    ids.set(n, id);
    return `⁽${toSup(n)}⁾`;
  });
  return { text, ids };
}

export function fromEditable(text: string, ids: Map<number, string>): { bs: string; removed: string[] } {
  const seen = new Set<string>();
  const bs = text.replace(/⁽([⁰¹²³⁴⁵⁶⁷⁸⁹]+)⁾/g, (_whole, sup) => {
    const id = ids.get(fromSup(sup));
    if (!id || seen.has(id)) return '';
    seen.add(id);
    return `[^${id}]`;
  });
  const removed = [...ids.values()].filter((id) => !seen.has(id));
  return { bs: bs.replace(/\s+/g, ' ').trim(), removed };
}

export const plainText = (bs: string) => bs.replace(MARKER, '');
