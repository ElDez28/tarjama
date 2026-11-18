import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AiSettings, ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  keyHint: string;
  keyUrl?: string;
  suggested: string[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    suggested: [],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    suggested: [],
  },
  {
    id: 'compatible',
    name: 'Drugi servis (OpenAI-kompatibilan)',
    keyHint: 'ključ servisa',
    suggested: [],
  },
  { id: 'demo', name: 'Probni rad (bez AI-ja)', keyHint: '', suggested: ['demo'] },
];

export const COMPATIBLE_PRESETS = [
  { name: 'OpenRouter (skoro svi modeli)', url: 'https://openrouter.ai/api/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com' },
  { name: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { name: 'Ollama na ovom računaru', url: 'http://localhost:11434/v1' },
];

export interface JsonRequest {
  system: string;
  user: string;
  /** PNG images, base64 without prefix. */
  images?: string[];
  schema: Record<string, unknown>;
  /** 'low' for reading pages, 'high' for translating. Only used where the model supports it. */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export class AiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

function explain(e: unknown): AiError {
  if (e instanceof AiError) return e;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any;
  if (err?.name === 'AbortError' || err?.constructor?.name === 'APIUserAbortError') return new AiError('Zaustavljeno.');
  const status: number | undefined = err?.status ?? err?.code;
  const detail = String(err?.error?.error?.message ?? err?.error?.message ?? err?.message ?? e).slice(0, 300);
  if (status === 401 || status === 403 || /api key not valid|invalid api key/i.test(detail)) return new AiError('Ključ nije prihvaćen. Provjeri da je ispravno kopiran i da je aktivan. (' + detail + ')');
  if (status === 404) return new AiError('Model nije pronađen. Izaberi drugi model u postavkama. (' + detail + ')');
  if (status === 429) return new AiError('Servis kaže da je previše zahtjeva ili da nema kredita na računu. (' + detail + ')', true);
  if (status && status >= 500) return new AiError('Servis trenutno ne radi kako treba. Pokušaću ponovo. (' + detail + ')', true);
  if (/fetch|network|cors|connection/i.test(detail))
    return new AiError(
      'Nema veze sa servisom. Ili nema interneta, ili ovaj servis ne dozvoljava pozive iz browsera (tada probaj preko OpenRoutera). (' + detail + ')',
      true,
    );
  return new AiError(detail);
}

const supportsEffort = (model: string) => /^claude-(opus|sonnet|haiku|fable)-5/.test(model);
const supportsFallbacks = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new AiError('Model nije vratio ispravan odgovor (JSON). Pokušaću ponovo.', true);
  }
}

export async function generateJson(s: AiSettings, req: JsonRequest): Promise<unknown> {
  try {
    switch (s.provider) {
      case 'anthropic':
        return await anthropicJson(s, req);
      case 'gemini':
        return await geminiJson(s, req);
      case 'openai':
      case 'compatible':
        return await openaiJson(s, req);
      default:
        throw new AiError('Probni rad nema AI model.');
    }
  } catch (e) {
    throw explain(e);
  }
}

async function anthropicJson(s: AiSettings, req: JsonRequest): Promise<unknown> {
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(req.images ?? []).map(
      (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }) as Anthropic.Beta.BetaImageBlockParam,
    ),
    { type: 'text', text: req.user },
  ];
  const params: Record<string, unknown> = {
    model: s.model,
    max_tokens: 32000,
    system: req.system,
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: req.schema },
      ...(req.effort && supportsEffort(s.model) ? { effort: req.effort } : {}),
    },
  };
  if (supportsFallbacks(s.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const stream = client.beta.messages.stream(
    params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming,
    { signal: req.signal },
  );
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new AiError('Model je odbio ovaj dio teksta. Probaj drugi model za ovu stranu.');
  if (msg.stop_reason === 'max_tokens') throw new AiError('Odgovor je predugačak za jedan zahtjev. Pokušaću s manjim dijelom.', true);
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return parseJson(text);
}

async function openaiJson(s: AiSettings, req: JsonRequest): Promise<unknown> {
  const client = new OpenAI({
    apiKey: s.apiKey || 'none',
    baseURL: s.provider === 'compatible' ? s.baseUrl.trim() || undefined : undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
  const user: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: req.user + '\n\nOdgovori samo JSON objektom po ovoj shemi:\n' + JSON.stringify(req.schema) },
    ...(req.images ?? []).map(
      (data) => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + data } }) as const,
    ),
  ];
  const res = await client.chat.completions.create(
    {
      model: s.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    },
    { signal: req.signal },
  );
  const choice = res.choices[0];
  if (choice?.finish_reason === 'length') throw new AiError('Odgovor je predugačak za jedan zahtjev. Pokušaću s manjim dijelom.', true);
  return parseJson(choice?.message?.content ?? '');
}

async function geminiJson(s: AiSettings, req: JsonRequest): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey: s.apiKey });
  const res = await ai.models.generateContent({
    model: s.model,
    contents: [
      {
        role: 'user',
        parts: [...(req.images ?? []).map((data) => ({ inlineData: { mimeType: 'image/png', data } })), { text: req.user }],
      },
    ],
    config: {
      systemInstruction: req.system,
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
      abortSignal: req.signal,
    },
  });
  return parseJson(res.text ?? '');
}

/** Lists the models this key can use, so nobody has to type a model name. */
export async function listModels(s: AiSettings): Promise<string[]> {
  try {
    if (s.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      return ids;
    }
    if (s.provider === 'openai' || s.provider === 'compatible') {
      const client = new OpenAI({
        apiKey: s.apiKey || 'none',
        baseURL: s.provider === 'compatible' ? s.baseUrl.trim() || undefined : undefined,
        dangerouslyAllowBrowser: true,
      });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids.sort();
    }
    if (s.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: s.apiKey });
      const ids: string[] = [];
      const pager = await ai.models.list();
      for await (const m of pager) {
        if (m.name && (m.supportedActions ?? []).includes('generateContent')) ids.push(m.name.replace(/^models\//, ''));
      }
      return ids;
    }
    return ['demo'];
  } catch (e) {
    throw explain(e);
  }
}
