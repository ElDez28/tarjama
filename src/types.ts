export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'compatible' | 'demo';

export interface AiSettings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** Only for 'compatible' (DeepSeek, OpenRouter, Mistral, Ollama…). */
  baseUrl: string;
}

/** One page of the Arabic book, after reading (text layer or AI vision). */
export interface SourcePage {
  /** 1-based page number in the PDF. */
  n: number;
  /** Body paragraphs, Arabic, logical order. */
  paras: string[];
  /** The page's own footnotes, Arabic, each usually starting with its number. */
  notes: string[];
  source: 'text' | 'vision';
}

/**
 * One row of the editor: an Arabic sentence (or several merged) and its
 * Bosnian translation. `bs` may contain footnote markers [^id].
 */
export interface Segment {
  id: string;
  ar: string;
  bs: string;
  /** PDF page the Arabic sentence starts on. */
  page: number;
  /** True when this sentence starts a new paragraph. */
  paraStart: boolean;
  heading: boolean;
  edited?: boolean;
}

export interface Footnote {
  id: string;
  text: string;
  /** Translated from the Arabic book's own footnote (not added by the translator). */
  fromSource?: boolean;
}

export type ReadMode = 'text' | 'vision';

export interface BookSettings {
  size: 'A5' | 'B5' | 'A4';
  fontSize: number;
  author: string;
  translator: string;
}

export interface Project {
  format: 'tarjama';
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pdf: { name: string; size: number; hash: string; pageCount: number };
  readMode: ReadMode;
  /** Pages read so far (index = n - 1, sparse until read). */
  pages: (SourcePage | null)[];
  /** Number of PDF pages already translated, from the start. */
  translatedPages: number;
  segments: Segment[];
  footnotes: Record<string, Footnote>;
  /** Extra instructions for the translator model, editable by the user. */
  rules: string;
  book: BookSettings;
}
