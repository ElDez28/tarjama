import { AiError, generateJson } from './ai';
import { readTextPage, renderPagePng, type PdfDoc } from './pdf';
import type { AiSettings, Footnote, Project, Segment, SourcePage } from './types';

export const DEFAULT_RULES = `Izraze عز وجل, جل شأنه, جل جلاله, تبارك وتعالى prevodi kao "Uzvišeni".
صلى الله عليه وسلم piši kao znak ﷺ odmah iza Poslanikovog imena.
Kur'anske ajete prevodi vjerno smislu i označi ih navodnicima „…“.`;

/* ---------- Arabic sentences ---------- */

const toWestern = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Splits an Arabic paragraph into sentences at . ! ? ؟ … and very long ones at ؛ */
export function splitSentences(para: string): string[] {
  const parts = para.split(/(?<=[.!?؟…۔])\s+(?=\S)/u).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const words = p.split(/\s+/).length;
    if (words > 70 && p.includes('؛')) out.push(...p.split(/(?<=؛)\s+/u));
    else out.push(p);
  }
  // glue tiny fragments (a footnote number, "قال:") to the next sentence
  const merged: string[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.split(/\s+/).length < 3) merged[merged.length - 1] = prev + ' ' + s;
    else merged.push(s);
  }
  return merged;
}

interface Unit {
  ar: string;
  page: number;
  paraStart: boolean;
}

interface NoteIn {
  key: string;
  page: number;
  num: number | null;
  ar: string;
}

function unitsOf(pages: SourcePage[]): { units: Unit[]; notes: NoteIn[] } {
  const units: Unit[] = [];
  const notes: NoteIn[] = [];
  for (const p of pages) {
    p.paras.forEach((para) => {
      splitSentences(para).forEach((ar, i) => units.push({ ar, page: p.n, paraStart: i === 0 }));
    });
    p.notes.forEach((ar, i) => {
      const m = toWestern(ar).match(/^\s*[([]?(\d+)[)\]]?/);
      notes.push({ key: `N${p.n}_${i + 1}`, page: p.n, num: m ? Number(m[1]) : null, ar });
    });
  }
  return { units, notes };
}

/* ---------- reading pages ---------- */

const READ_SCHEMA = {
  type: 'object',
  properties: {
    paras: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['paras', 'notes'],
  additionalProperties: false,
};

const READ_SYSTEM = `Čitaš skeniranu stranicu arapske knjige. Prepiši arapski tekst tačno onako kako je odštampan, sa harekatima ako ih ima, bez prevođenja i bez ispravljanja.
- "paras": paragrafi glavnog teksta, redom kako se čitaju (zdesna nalijevo, odozgo nadolje). Naslov je zaseban paragraf.
- "notes": fusnote sa dna stranice (ispod crte), svaka zasebno, sa svojim brojem na početku, npr. "(١) ...".
- Izostavi broj stranice i naslov knjige ili poglavlja koji se ponavlja na vrhu svake stranice.
- Oznake fusnota u tekstu, npr. (١), ostavi tamo gdje jesu.
- Ako je stranica prazna ili ima samo sliku, vrati prazne nizove.`;

export async function readPage(doc: PdfDoc, n: number, mode: Project['readMode'], ai: AiSettings, signal?: AbortSignal): Promise<SourcePage> {
  const text = await readTextPage(doc, n);
  const textLooksUsable = text.arabicChars > 40;
  if (mode === 'text' && (textLooksUsable || ai.provider === 'demo')) {
    return { n, paras: text.paras, notes: text.notes, source: 'text' };
  }
  if (ai.provider === 'demo') {
    return { n, paras: text.paras.length ? text.paras : ['هذا نص تجريبي. لا يوجد نموذج ذكاء اصطناعي في الوضع التجريبي.'], notes: text.notes, source: 'text' };
  }
  const png = await renderPagePng(doc, n);
  const res = (await generateJson(ai, {
    system: READ_SYSTEM,
    user: `Stranica ${n}. Vrati JSON sa "paras" i "notes".`,
    images: [png],
    schema: READ_SCHEMA,
    effort: 'low',
    signal,
  })) as { paras?: unknown; notes?: unknown };
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
  return { n, paras: arr(res.paras).map((s) => s.normalize('NFKC').trim()), notes: arr(res.notes).map((s) => s.normalize('NFKC').trim()), source: 'vision' };
}

/* ---------- translating ---------- */

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' } },
          bs: { type: 'string' },
          heading: { type: 'boolean' },
          skip: { type: 'boolean' },
        },
        required: ['ids', 'bs', 'heading', 'skip'],
        additionalProperties: false,
      },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, bs: { type: 'string' } },
        required: ['key', 'bs'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups', 'notes'],
  additionalProperties: false,
};

function translateSystem(rules: string) {
  return `Ti si iskusan prevodilac arapske, posebno islamske, literature na bosanski jezik.
Prevodiš knjigu rečenicu po rečenicu, a prevod će se kasnije složiti u knjigu.

Kako prevoditi:
- Književni bosanski jezik, ijekavica, latinica. Prirodan red riječi, ne doslovno, ali bez dodavanja i izostavljanja smisla.
- Imena i termine piši kako je uobičajeno u bosanskoj islamskoj literaturi (npr. Muhammed, Ebu Hurejre, hadis, sunnet).
- Oznaku fusnote u arapskom tekstu, npr. (١) ili (1), u prevodu napiši kao [^1] na istom mjestu u rečenici.

Pravila prevodioca (imaju prednost):
${rules.trim() || '(nema)'}

Format odgovora:
- "groups": svaka arapska rečenica ima broj. Svaki broj se mora pojaviti tačno jednom, redom. Obično je jedna rečenica jedna grupa; spoji uzastopne brojeve u jednu grupu samo kad se bez toga ne može dobro prevesti.
- "heading": true ako je to naslov poglavlja ili odjeljka.
- "skip": true samo za nešto što nije tekst knjige (naslov koji se ponavlja na vrhu stranice, broj stranice); tada "bs" ostavi prazan.
- "notes": prevod svake fusnote po njenom ključu, bez broja na početku.`;
}

interface GroupOut {
  ids: number[];
  bs: string;
  heading: boolean;
  skip: boolean;
}

let idCounter = Date.now() % 1e6;
const newId = (p: string) => p + (idCounter++).toString(36);

function demoTranslate(units: Unit[], notes: NoteIn[]): { groups: GroupOut[]; notes: { key: string; bs: string }[] } {
  return {
    groups: units.map((u, i) => {
      const marks = [...toWestern(u.ar).matchAll(/\((\d+)\)/g)].map((m) => ` [^${m[1]}]`).join('');
      return { ids: [i + 1], bs: `Probni prevod rečenice ${i + 1} sa strane ${u.page}.${marks}`, heading: false, skip: false };
    }),
    notes: notes.map((n) => ({ key: n.key, bs: `Probni prevod fusnote ${n.num ?? ''}.` })),
  };
}

function validGroups(groups: unknown, count: number): GroupOut[] | null {
  if (!Array.isArray(groups)) return null;
  let next = 1;
  const out: GroupOut[] = [];
  for (const g of groups) {
    if (!g || !Array.isArray(g.ids) || typeof g.bs !== 'string') return null;
    for (const id of g.ids) if (id !== next++) return null;
    if (!g.ids.length) return null;
    out.push({ ids: g.ids, bs: g.bs, heading: !!g.heading, skip: !!g.skip });
  }
  return next === count + 1 ? out : null;
}

/** Translates one chunk of pages and returns the new segments and footnotes. */
export async function translatePages(
  pages: SourcePage[],
  before: Segment[],
  rules: string,
  ai: AiSettings,
  signal?: AbortSignal,
): Promise<{ segments: Segment[]; footnotes: Footnote[] }> {
  const { units, notes } = unitsOf(pages);
  if (!units.length && !notes.length) return { segments: [], footnotes: [] };

  const context = before
    .filter((s) => s.bs)
    .slice(-4)
    .map((s) => `${s.ar}\n→ ${s.bs}`)
    .join('\n');
  const user =
    (context ? `Prethodni prevod (samo radi povezanosti, ne prevodi ponovo):\n${context}\n\n` : '') +
    `Arapske rečenice:\n${units.map((u, i) => `[${i + 1}] ${u.ar}`).join('\n')}` +
    (notes.length ? `\n\nFusnote sa ovih stranica:\n${notes.map((n) => `{${n.key}} ${n.ar}`).join('\n')}` : '');

  type Raw = { groups?: unknown; notes?: unknown } | null;
  let res: Raw = null;
  let groups: GroupOut[] | null = null;
  if (ai.provider === 'demo') {
    res = demoTranslate(units, notes);
    groups = res.groups as GroupOut[];
  } else {
    for (let attempt = 0; attempt < 2 && !groups; attempt++) {
      res = (await generateJson(ai, {
        system: translateSystem(rules),
        user:
          user +
          (attempt
            ? `\n\nPAŽNJA: u prošlom odgovoru brojevi rečenica nisu bili potpuni ili po redu. Moraš vratiti svih ${units.length} brojeva, svaki tačno jednom, redom.`
            : ''),
        schema: TRANSLATE_SCHEMA,
        effort: 'high',
        signal,
      })) as Raw;
      groups = validGroups(res?.groups, units.length);
    }
    if (!groups) {
      // keep the work moving: one row per sentence, the untranslated ones stay empty for the user
      groups = units.map((_, i) => ({ ids: [i + 1], bs: '', heading: false, skip: false }));
    }
  }

  // footnotes from the Arabic book
  const noteTr = new Map<string, string>();
  if (Array.isArray(res?.notes)) for (const n of res.notes as { key: string; bs: string }[]) noteTr.set(n.key, n.bs);
  const footnotes: Footnote[] = [];
  const noteIdByPageNum = new Map<string, string>();
  for (const n of notes) {
    const id = newId('f');
    const text = (noteTr.get(n.key) ?? '').replace(/^\s*[([]?\d+[)\]]?\s*[-–.]?\s*/, '').trim();
    footnotes.push({ id, text: text || '(fusnota nije prevedena) ' + n.ar, fromSource: true });
    if (n.num != null) noteIdByPageNum.set(`${n.page}:${n.num}`, id);
  }
  const used = new Set<string>();

  const segments: Segment[] = [];
  for (const g of groups) {
    if (g.skip) continue;
    const first = units[g.ids[0] - 1];
    const ar = g.ids.map((i) => units[i - 1].ar).join(' ');
    const pagesOfGroup = [...new Set(g.ids.map((i) => units[i - 1].page))];
    const bs = g.bs.replace(/\[\^(\d+)\]/g, (_whole, num) => {
      for (const p of pagesOfGroup) {
        const id = noteIdByPageNum.get(`${p}:${num}`);
        if (id && !used.has(id)) {
          used.add(id);
          return `[^${id}]`;
        }
      }
      return '';
    });
    segments.push({ id: newId('s'), ar, bs: bs.trim(), page: first.page, paraStart: first.paraStart, heading: g.heading });
  }
  // a source footnote the translation did not mark is attached to the last sentence of its page
  for (const n of notes) {
    const id = n.num != null ? noteIdByPageNum.get(`${n.page}:${n.num}`) : undefined;
    const fid = id ?? footnotes[notes.indexOf(n)].id;
    if (used.has(fid)) continue;
    const host = [...segments].reverse().find((s) => s.page === n.page) ?? segments[segments.length - 1];
    if (host) host.bs += ` [^${fid}]`;
    used.add(fid);
  }
  return { segments, footnotes };
}

/* ---------- the whole job ---------- */

export interface JobProgress {
  phase: 'reading' | 'translating' | 'waiting';
  page: number;
  total: number;
  message?: string;
}

const PAGES_PER_CHUNK = 2;

/**
 * Reads and translates the book from where it stopped, chunk by chunk.
 * After every chunk `commit` gets the updated project, so the work is saved
 * and nothing is lost when the browser closes.
 */
export async function runTranslation(
  start: Project,
  doc: PdfDoc,
  ai: AiSettings,
  commit: (p: Project) => void,
  progress: (p: JobProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  let p = start;
  const total = p.pdf.pageCount;
  while (p.translatedPages < total) {
    if (signal.aborted) throw new AiError('Zaustavljeno.');
    const from = p.translatedPages + 1;
    const to = Math.min(total, from + PAGES_PER_CHUNK - 1);

    const pages = [...p.pages];
    for (let n = from; n <= to; n++) {
      if (pages[n - 1]) continue;
      progress({ phase: 'reading', page: n, total });
      pages[n - 1] = await withRetry(() => readPage(doc, n, p.readMode, ai, signal), progress, n, total, signal);
    }
    p = { ...p, pages };
    commit(p);

    progress({ phase: 'translating', page: from, total });
    const chunk = pages.slice(from - 1, to) as SourcePage[];
    const { segments, footnotes } = await withRetry(() => translatePages(chunk, p.segments, p.rules, ai, signal), progress, from, total, signal);
    const fn = { ...p.footnotes };
    for (const f of footnotes) fn[f.id] = f;
    p = { ...p, segments: [...p.segments, ...segments], footnotes: fn, translatedPages: to };
    commit(p);
  }
}

async function withRetry<T>(fn: () => Promise<T>, progress: (p: JobProgress) => void, page: number, total: number, signal: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(String((e as Error)?.message ?? e));
      if (!err.retryable || attempt >= 4 || signal.aborted) throw err;
      const wait = 5000 * attempt;
      progress({ phase: 'waiting', page, total, message: err.message + ` Novi pokušaj za ${wait / 1000} s.` });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
