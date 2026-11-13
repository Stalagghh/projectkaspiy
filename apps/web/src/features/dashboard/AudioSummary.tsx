import { ArrowUpRight, AudioLines } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { AlertDto } from '@ecoshield/contracts';

import { Panel, StatusBadge } from '@/components/Panel';
import { ClipPlayer } from '@/features/audio/ClipPlayer';
import { AUDIO_LABEL, formatDateTime, formatPercent } from '@/lib/labels';

import type { LoadState } from './useLiveAlerts';

export function AudioSummary({ alerts, loadState, onRetry }: { alerts: AlertDto[]; loadState: LoadState; onRetry: () => void }) {
  const latest = [...alerts].filter((alert) => alert.clipId).sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt))[0];
  return <Panel title="Аудиоанализ" id="audio-preview-title" className="audio-summary" action={<Link className="text-link" href="/audio">Открыть <ArrowUpRight size={16} aria-hidden="true" /></Link>}>
    {latest ? <SummaryRecording key={latest.clipId} alert={latest} /> : loadState !== 'ready' ? <div className="summary-empty" role={loadState === 'error' ? 'alert' : 'status'} aria-busy={loadState === 'loading'}><span>{loadState === 'loading' ? 'Загружаем записи событий…' : 'Не удалось загрузить записи событий.'}</span>{loadState === 'error' && <button className="text-link" type="button" onClick={onRetry}>Повторить</button>}</div> : <div className="summary-empty"><AudioLines size={28} strokeWidth={1.5} aria-hidden="true" /><span>Записей пока нет. Загрузите аудио для анализа или запустите сценарий.</span><Link className="text-link" href="/audio">Загрузить запись <ArrowUpRight size={15} aria-hidden="true" /></Link></div>}
  </Panel>;
}

function SummaryRecording({ alert }: { alert: AlertDto }) {
  const [playing, setPlaying] = useState(false);
  return <>
    <div className="audio-summary-meta"><AudioLines size={20} aria-hidden="true" /><strong>{alert.detection ? AUDIO_LABEL[alert.detection.label] ?? alert.detection.label : 'Ожидает классификации'}</strong>{alert.detection && <span className="num">{formatPercent(alert.detection.confidence)}</span>}<StatusBadge tone={playing ? 'healthy' : 'neutral'}>{playing ? 'Воспроизведение' : 'Запись'}{alert.isSimulated ? ' · симуляция' : ''}</StatusBadge></div>
    <ClipPlayer src={`/api/clips/${alert.clipId}/audio`} compact onActivity={setPlaying} label={`Запись: ${alert.deviceName ?? 'устройство'}, ${formatDateTime(alert.eventAt)}`} />
    <p className="caption">Последняя запись · {alert.deviceName} · {formatDateTime(alert.eventAt)}</p>
  </>;
}
