'use client';
// /audio screen: the inspector uploads a recording and sees what the audio model hears.
// The file goes to POST /api/audio/classify as raw bytes; nothing is stored and no alert is made.
import { type ClassifyResponse, classifyResponseSchema } from '@ecoshield/contracts';
import { AudioLines, FileMusic, Info, LoaderCircle, TriangleExclamationPoint, Upload } from 'lucide-react';
import { type CSSProperties, type DragEvent, useRef, useState } from 'react';

import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_EXTENSIONS,
  AUDIO_ERROR_RU,
  AUDIO_LABEL_RU,
  MAX_UPLOAD_BYTES,
  QUALITATIVE_RU,
} from './labels';

type State =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'analyzing' }
  | { status: 'done'; result: ClassifyResponse }
  | { status: 'error'; message: string };

const seconds = (value: number): string =>
  `${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0с`;
const percent = (share: number): string => `${Math.round(share * 100)}\u202f%`;
const megabytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}\u00a0МБ`;

/** Checks the file in the browser first; the server repeats every check. */
function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return 'Неподдерживаемый формат. Загрузите запись WAV, MP3, FLAC или OGG.';
  }
  if (file.size === 0) return 'Файл пустой.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Файл ${megabytes(file.size)} — больше допустимых 10 МБ.`;
  }
  return null;
}

/** XMLHttpRequest instead of fetch: it reports upload progress. */
function upload(file: File, onProgress: (share: number) => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/audio/classify');
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.upload.onload = () => onProgress(1);
    request.onload = () => resolve({ status: request.status, body: request.response as unknown });
    request.onerror = () => reject(new Error('network'));
    request.ontimeout = () => reject(new Error('timeout'));
    request.timeout = 60_000;
    request.send(file);
  });
}

export function AudioAnalyzer() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.status === 'uploading' || state.status === 'analyzing';

  async function analyze(selected: File) {
    setFile(selected);
    const problem = validateFile(selected);
    if (problem) {
      setState({ status: 'error', message: problem });
      return;
    }
    setState({ status: 'uploading', progress: 0 });
    try {
      const { status, body } = await upload(selected, (share) =>
        setState(share >= 1 ? { status: 'analyzing' } : { status: 'uploading', progress: share }),
      );
      if (status !== 200) {
        const code = (body as { error?: string } | null)?.error ?? '';
        setState({ status: 'error', message: AUDIO_ERROR_RU[code] ?? `Ошибка сервера (${status}).` });
        return;
      }
      const parsed = classifyResponseSchema.safeParse(body);
      if (!parsed.success) {
        setState({ status: 'error', message: AUDIO_ERROR_RU.ml_invalid_response ?? 'Неожиданный ответ.' });
        return;
      }
      setState({ status: 'done', result: parsed.data });
    } catch {
      setState({ status: 'error', message: 'Нет связи с сервером. Проверьте подключение и повторите.' });
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer.files[0];
    if (dropped) void analyze(dropped);
  }

  return (
    <div className="audio-page">
      <div className="audio-intake">
        <header>
          <h1 className="page-title">Анализ аудиозаписи</h1>
          <p className="page-lead">
            Загрузите запись с места событий — модель оценит, слышен ли мотор лодки или выстрел.
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const selected = file ?? inputRef.current?.files?.[0];
            if (selected) void analyze(selected);
            else setState({ status: 'error', message: 'Выберите файл записи.' });
          }}
          className="audio-intake"
        >
          <label
            htmlFor="audio-file"
            className="dropzone"
            data-dragging={dragging}
            data-busy={busy}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="dropzone-icon">
              <Upload size={22} aria-hidden="true" />
            </span>
            <span className="dropzone-title">Перетащите файл сюда или нажмите, чтобы выбрать</span>
            <span className="dropzone-hint">WAV, MP3, FLAC или OGG · до 10 МБ · до 60 секунд</span>
            {file ? (
              <span className="file-pill">
                <FileMusic size={15} aria-hidden="true" />
                <span>{file.name}</span>
                <span className="num">{megabytes(file.size)}</span>
              </span>
            ) : null}
            <input
              ref={inputRef}
              id="audio-file"
              name="file"
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              data-testid="audio-file-input"
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0];
                if (selected) void analyze(selected);
              }}
            />
          </label>
          <button type="submit" className="btn btn-brand" data-testid="audio-submit" disabled={busy || !file}>
            {busy ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <AudioLines size={16} aria-hidden="true" />
            )}
            {state.status === 'done' || state.status === 'error' ? 'Анализировать ещё раз' : 'Анализировать'}
          </button>
        </form>

        <div aria-live="polite">
          {state.status === 'uploading' ? (
            <div role="status" className="audio-intake" style={{ gap: 8 }}>
              <p className="status-line">
                Загрузка файла… <span className="num">{percent(state.progress)}</span>
              </p>
              <progress max={1} value={state.progress} className="progress" />
            </div>
          ) : null}
          {state.status === 'analyzing' ? (
            <p role="status" className="status-line">
              <LoaderCircle size={16} className="spin" aria-hidden="true" /> Модель анализирует запись…
            </p>
          ) : null}
          {state.status === 'error' ? (
            <p role="alert" data-testid="audio-error" className="note note-critical">
              <TriangleExclamationPoint size={16} aria-hidden="true" />
              {state.message}
            </p>
          ) : null}
        </div>

        <p className="note">
          <Info size={16} style={{ color: 'var(--info)' }} aria-hidden="true" />
          <span>
            Только анализ: тревога по загруженному файлу не создаётся, файл не сохраняется.
            <br />
            ИИ предполагает, решение принимает инспектор.
          </span>
        </p>
      </div>

      {state.status === 'done' ? (
        <AudioResult result={state.result} />
      ) : (
        <div className="result-placeholder">
          <AudioLines size={30} aria-hidden="true" />
          <strong>Здесь появится результат</strong>
          Что услышала модель, насколько она уверена, спектрограмма записи и найденные события по времени.
        </div>
      )}
    </div>
  );
}

function AudioResult({ result }: { result: ClassifyResponse }) {
  const { summary } = result;
  const label = AUDIO_LABEL_RU[summary.label] ?? summary.label;
  const qualitative = QUALITATIVE_RU[summary.qualitative] ?? summary.qualitative;
  const tone =
    summary.label === 'gunshot' ? 'var(--critical)' : summary.label === 'boat_engine' ? 'var(--warning)' : 'var(--brand)';
  // Background has no threshold of its own: the mark is shown only for the two target sounds.
  const threshold =
    summary.label === 'gunshot'
      ? result.thresholds.gunshot
      : summary.label === 'boat_engine'
        ? result.thresholds.boat_engine
        : null;

  return (
    <section
      data-testid="audio-result"
      data-label={summary.label}
      data-confidence={summary.confidence}
      aria-labelledby="audio-result-title"
      className="result"
      style={{ '--tone': tone } as CSSProperties}
    >
      <div className="section">
        <div className="ai-verdict">
          <div>
            <h2 id="audio-result-title" className="eyebrow">
              ИИ предполагает
            </h2>
            <strong className="ai-label" style={{ color: tone }}>
              {label}
            </strong>
          </div>
          <div className="ai-score num">
            {percent(summary.confidence)}
            <span className="ai-qual">{qualitative}</span>
          </div>
        </div>
        <div className="gauge" aria-hidden="true">
          <span className="gauge-fill" style={{ display: 'block', width: `${Math.round(summary.confidence * 100)}%`, background: tone }} />
          {threshold !== null ? <span className="gauge-tick" style={{ left: `${Math.round(threshold * 100)}%` }} /> : null}
        </div>
        <p className="caption">
          {threshold !== null ? <>Отметка на шкале — порог срабатывания {percent(threshold)} (предварительный). </> : null}
          Решение — за инспектором.
        </p>
      </div>

      {result.spectrogramPng ? (
        <figure className="section" style={{ margin: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL from the ML service */}
          <img
            data-testid="audio-spectrogram"
            src={`data:image/png;base64,${result.spectrogramPng}`}
            alt={`Спектрограмма записи длительностью ${seconds(result.durationS)}`}
            className="spectrogram"
          />
          <figcaption className="caption">
            Лог-мел спектрограмма: время по горизонтали, частота по вертикали, яркость — громкость.
          </figcaption>
        </figure>
      ) : null}

      <div className="section">
        <h3 className="eyebrow">Обнаруженные события</h3>
        {result.events.length > 0 ? (
          <ul className="event-list">
            {result.events.map((event) => (
              <li key={`${event.label}-${event.startS}`}>
                <span>{AUDIO_LABEL_RU[event.label] ?? event.label}</span>
                <span className="num">
                  {seconds(event.startS)}–{seconds(event.endS)} · {percent(event.confidence)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="caption">Событий выше порогов не найдено.</p>
        )}
      </div>

      <div className="section">
        <h3 className="eyebrow">Что слышит модель — классы AudioSet</h3>
        <ul className="bars">
          {summary.topK.map((item) => (
            <li key={item.name} className="bar-row">
              <span className="bar-name" title={item.name}>
                {item.name}
              </span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ width: `${Math.round(item.score * 100)}%` }} />
              </span>
              <span className="num">{percent(item.score)}</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="kv">
        <dt>Модель</dt>
        <dd>
          <span className="mono">
            {result.model.name} {result.model.version}
          </span>
        </dd>
        <dt>Запись</dt>
        <dd className="num">
          {seconds(result.durationS)} · {result.sampleRate.toLocaleString('ru-RU')} Гц
        </dd>
        <dt>Пороги</dt>
        <dd>
          <span className="num">
            мотор ≥ {result.thresholds.boat_engine.toLocaleString('ru-RU')}, выстрел ≥{' '}
            {result.thresholds.gunshot.toLocaleString('ru-RU')}
          </span>{' '}
          — предварительные, до проверки на размеченной выборке
        </dd>
      </dl>
    </section>
  );
}
