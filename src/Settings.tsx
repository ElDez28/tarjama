import { useState } from 'react';
import { COMPATIBLE_PRESETS, PROVIDERS, listModels } from './ai';
import type { AiSettings, ProviderId } from './types';

export function Settings({ value, onSave, onClose }: { value: AiSettings; onSave: (s: AiSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<AiSettings>(value);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const info = PROVIDERS.find((p) => p.id === s.provider)!;
  const choices = [...new Set([...info.suggested, ...models])];

  const setProvider = (id: ProviderId) => {
    const p = PROVIDERS.find((x) => x.id === id)!;
    setS({ ...s, provider: id, model: p.suggested[0] ?? '', baseUrl: id === 'compatible' ? s.baseUrl || COMPATIBLE_PRESETS[0].url : s.baseUrl });
    setModels([]);
    setMsg(null);
  };

  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const list = await listModels(s);
      setModels(list);
      setMsg({ ok: true, text: `Ključ radi. Dostupnih modela: ${list.length}.` });
      if (!s.model && list[0]) setS((x) => ({ ...x, model: list[0] }));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="set-title">
        <h2 id="set-title">AI za prevod</h2>
        <p className="muted">Ključ ostaje samo u ovom browseru, na ovom računaru. Prevod ide direktno od tebe do servisa koji izabereš i plaća se na tvom računu kod tog servisa.</p>

        <label className="field">
          <span>Servis</span>
          <select value={s.provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {s.provider === 'compatible' && (
          <label className="field">
            <span>Adresa servisa</span>
            <input value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} placeholder="https://…/v1" list="presets" />
            <datalist id="presets">
              {COMPATIBLE_PRESETS.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.name}
                </option>
              ))}
            </datalist>
            <small className="muted">Na primjer: {COMPATIBLE_PRESETS.map((p) => p.name).join(', ')}.</small>
          </label>
        )}

        {s.provider !== 'demo' && (
          <label className="field">
            <span>API ključ</span>
            <input type="password" autoComplete="off" value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value.trim() })} placeholder={info.keyHint} />
            {info.keyUrl && (
              <small>
                <a href={info.keyUrl} target="_blank" rel="noreferrer">
                  Gdje se pravi ključ
                </a>
              </small>
            )}
          </label>
        )}

        {s.provider !== 'demo' && (
          <label className="field">
            <span>Model</span>
            <div className="row">
              <input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value.trim() })} list="models" placeholder="naziv modela" />
              <button type="button" className="btn" onClick={check} disabled={busy || (!s.apiKey && s.provider !== 'compatible')}>
                {busy ? 'Provjeravam…' : 'Provjeri ključ'}
              </button>
            </div>
            <datalist id="models">
              {choices.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <small className="muted">Za čitanje skeniranih stranica model mora razumjeti slike. Jači model prevodi bolje, ali košta više.</small>
          </label>
        )}

        {s.provider === 'demo' && <p className="note">Probni rad ne prevodi. Služi samo da isprobaš aplikaciju bez ključa.</p>}

        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}

        <div className="actions">
          <button className="btn" onClick={onClose}>
            Odustani
          </button>
          <button
            className="btn primary"
            onClick={() => onSave(s)}
            disabled={s.provider !== 'demo' && (!s.model || (!s.apiKey && s.provider !== 'compatible'))}
          >
            Sačuvaj
          </button>
        </div>
      </div>
    </div>
  );
}
