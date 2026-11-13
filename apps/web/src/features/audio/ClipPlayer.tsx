'use client';
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Waveform is decoded from the actual recording; no synthetic "live" signal. */
export function ClipPlayer({ src, label, compact = false, onActivity }: { src: string; label: string; compact?: boolean; onActivity?: (playing: boolean) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  useEffect(() => {
    const controller = new AbortController();
    let context: AudioContext | undefined;
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error('clip unavailable');
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes);
        const pcm = decoded.getChannelData(0);
        const size = Math.max(1, Math.floor(pcm.length / 64));
        const values = Array.from({ length: 64 }, (_, index) => {
          let peak = 0;
          for (let i = index * size; i < Math.min(pcm.length, (index + 1) * size); i++) peak = Math.max(peak, Math.abs(pcm[i]!));
          return peak;
        });
        const max = Math.max(...values, 0.01);
        if (!controller.signal.aborted) setPeaks(values.map((peak) => peak / max));
      } catch { /* The native player remains available if waveform decoding is unsupported. */ }
      finally { if (context && context.state !== 'closed') void context.close(); }
    })();
    return () => { controller.abort(); };
  }, [src]);
  return <div className="clip-player">
    <div className="clip-visual">
      <button className="play-button" type="button" aria-label={playing ? `Приостановить: ${label}` : `Воспроизвести: ${label}`} onClick={() => {
        const player = audio.current;
        if (!player) return;
        if (player.paused) void player.play().catch(() => setError('Не удалось воспроизвести запись.'));
        else player.pause();
      }}>{playing ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}</button>
      <div className="waveform-frame">{peaks.length ? <svg viewBox="0 0 320 42" preserveAspectRatio="none" aria-label="Амплитуда выбранной аудиозаписи" role="img">{peaks.map((peak, index) => <rect key={index} x={index * 5} y={21 - Math.max(1, peak * 20)} width="2.5" height={Math.max(2, peak * 40)} rx="1.25" />)}</svg> : <span className="caption">Визуализация записи недоступна</span>}
      {compact && <input className="waveform-seek" type="range" min={0} max={duration || 1} step={0.1} value={position} disabled={!duration} aria-label="Позиция воспроизведения" aria-valuetext={`${time(position)} из ${time(duration)}`} onChange={(event) => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }} />}</div>
    </div>
    {compact && <div className="playback-time num"><span>{time(position)}</span><span>{time(duration)}</span></div>}
    <audio ref={audio} src={src} controls={!compact} preload="metadata" className={compact ? 'sr-only' : 'player'} aria-label={label} onLoadedMetadata={() => setDuration(Number.isFinite(audio.current?.duration) ? audio.current!.duration : 0)} onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => { setPlaying(true); onActivity?.(true); }} onPause={() => { setPlaying(false); onActivity?.(false); }} onEnded={() => { setPlaying(false); onActivity?.(false); }} onError={() => setError('Запись недоступна.')} />
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
