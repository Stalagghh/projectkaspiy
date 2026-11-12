'use client';
// /audio screen: the inspector uploads a recording and sees what the audio model hears.
// The file goes to POST /api/audio/classify as raw bytes; nothing is stored and no alert is made.
import { type ClassifyResponse, classifyResponseSchema } from '@ecoshield/contracts';
import { AudioLines, FileMusic, Info, LoaderCircle, TriangleExclamationPoint, Upload } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';

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
const percent = (share: number): string => `${Math.round(share * 100)}\u00a0%`;
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Анализ аудиозаписи</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Загрузите запись с места событий — модель оценит, слышен ли мотор лодки или выстрел.
        </p>
      </header>

      <ul className="space-y-1 rounded-md border border-[var(--info)]/50 bg-[var(--info)]/10 px-3 py-2 text-sm">
        <li className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--info)]" aria-hidden="true" />
          Только анализ: тревога по загруженному файлу не создаётся
        </li>
        <li className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--info)]" aria-hidden="true" />
          ИИ предполагает, решение принимает инспектор
        </li>
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const selected = file ?? inputRef.current?.files?.[0];
          if (selected) void analyze(selected);
          else setState({ status: 'error', message: 'Выберите файл записи.' });
        }}
        className="flex flex-col gap-3"
      >
        <label
          htmlFor="audio-file"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] ${
            dragging ? 'border-[var(--brand)] bg-[var(--brand)]/10' : 'border-white/20 bg-[var(--surface)] hover:bg-[var(--raised)]'
          }`}
        >
          <Upload className="size-7 text-[var(--brand)]" aria-hidden="true" />
          <span className="font-medium">Перетащите файл сюда или нажмите, чтобы выбрать</span>
          <span className="text-xs text-[var(--muted)]">WAV, MP3, FLAC или OGG · до 10 МБ · до 60 секунд</span>
          {file ? (
            <span className="inline-flex items-center gap-1 text-sm">
              <FileMusic className="size-4" aria-hidden="true" /> {file.name} · {megabytes(file.size)}
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
        <button
          type="submit"
          data-testid="audio-submit"
          disabled={busy || !file}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-md bg-[var(--brand)] px-4 font-medium text-[var(--bg)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <AudioLines className="size-4" aria-hidden="true" />
          {state.status === 'done' || state.status === 'error' ? 'Анализировать ещё раз' : 'Анализировать'}
        </button>
      </form>

      <div aria-live="polite">
        {state.status === 'uploading' ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="text-sm">Загрузка файла… {percent(state.progress)}</span>
            <progress max={1} value={state.progress} className="h-2 w-full accent-[var(--brand)]" />
          </div>
        ) : null}
        {state.status === 'analyzing' ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Модель анализирует запись…
          </p>
        ) : null}
        {state.status === 'error' ? (
          <p
            role="alert"
            data-testid="audio-error"
            className="flex items-start gap-2 rounded-md border border-[var(--critical)]/60 bg-[var(--critical)]/10 px-3 py-2 text-sm"
          >
            <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0 text-[var(--critical)]" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}
      </div>

      {state.status === 'done' ? <AudioResult result={state.result} /> : null}
    </div>
  );
}

function AudioResult({ result }: { result: ClassifyResponse }) {
  const { summary } = result;
  const label = AUDIO_LABEL_RU[summary.label] ?? summary.label;
  const qualitative = QUALITATIVE_RU[summary.qualitative] ?? summary.qualitative;
  const tone =
    summary.label === 'gunshot' ? 'var(--critical)' : summary.label === 'boat_engine' ? 'var(--warning)' : 'var(--brand)';

  return (
    <section
      data-testid="audio-result"
      data-label={summary.label}
      data-confidence={summary.confidence}
      aria-labelledby="audio-result-title"
      className="flex flex-col gap-4 rounded-lg border border-white/10 bg-[var(--surface)] p-4"
    >
      <div>
        <h2 id="audio-result-title" className="text-sm font-medium text-[var(--muted)]">
          Результат анализа
        </h2>
        <p className="mt-1 text-2xl font-semibold" style={{ color: tone }}>
          {label}
        </p>
        <p className="mt-1 text-sm">
          ИИ предполагает: {label.toLowerCase()} ({percent(summary.confidence)}, {qualitative}). Решение — за
          инспектором.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded bg-[var(--raised)]" aria-hidden="true">
            <div className="h-full rounded" style={{ width: `${Math.round(summary.confidence * 100)}%`, background: tone }} />
          </div>
          <span className="font-mono text-sm tabular-nums">{percent(summary.confidence)}</span>
        </div>
      </div>

      {result.spectrogramPng ? (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL from the ML service */}
          <img
            data-testid="audio-spectrogram"
            src={`data:image/png;base64,${result.spectrogramPng}`}
            alt={`Спектрограмма записи длительностью ${seconds(result.durationS)}`}
            className="h-auto w-full rounded border border-white/10 [image-rendering:pixelated]"
          />
          <figcaption className="mt-1 text-xs text-[var(--muted)]">
            Лог-мел спектрограмма: время по горизонтали, частота по вертикали.
          </figcaption>
        </figure>
      ) : null}

      <div>
        <h3 className="text-sm font-medium text-[var(--muted)]">Обнаруженные события</h3>
        {result.events.length > 0 ? (
          <ul className="mt-1 space-y-1 text-sm">
            {result.events.map((event) => (
              <li key={`${event.label}-${event.startS}`} className="flex justify-between gap-2">
                <span>{AUDIO_LABEL_RU[event.label] ?? event.label}</span>
                <span className="font-mono tabular-nums">
                  {seconds(event.startS)}–{seconds(event.endS)} · {percent(event.confidence)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm">Событий выше порогов не найдено.</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-[var(--muted)]">Топ классов AudioSet</h3>
        <ul className="mt-1 space-y-1.5 text-sm">
          {summary.topK.map((item) => (
            <li key={item.name}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{item.name}</span>
                <span className="font-mono tabular-nums">{percent(item.score)}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-[var(--raised)]" aria-hidden="true">
                <div className="h-full rounded bg-[var(--info)]" style={{ width: `${Math.round(item.score * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-[var(--muted)]">Модель</dt>
        <dd>
          {result.model.name} <span className="font-mono">v{result.model.version}</span>
        </dd>
        <dt className="text-[var(--muted)]">Длительность</dt>
        <dd className="font-mono tabular-nums">
          {seconds(result.durationS)} · {result.sampleRate.toLocaleString('ru-RU')} Гц
        </dd>
        <dt className="text-[var(--muted)]">Пороги</dt>
        <dd>
          <span className="font-mono tabular-nums">
            мотор ≥ {result.thresholds.boat_engine.toLocaleString('ru-RU')}, выстрел ≥{' '}
            {result.thresholds.gunshot.toLocaleString('ru-RU')}
          </span>{' '}
          <span className="text-[var(--muted)]">(предварительные, до проверки на валидации)</span>
        </dd>
      </dl>
    </section>
  );
}
