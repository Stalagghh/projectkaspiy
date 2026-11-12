// /audio: server shell around the client upload form.
import type { Metadata } from 'next';

import { TopBar } from '@/components/TopBar';

import { AudioAnalyzer } from '../../features/audio/AudioAnalyzer';

export const metadata: Metadata = {
  title: 'Анализ аудио',
  description: 'Загрузка аудиозаписи и распознавание мотора лодки или выстрела моделью ИИ.',
};

export default function AudioPage() {
  return (
    <>
      <TopBar />
      <main>
        <AudioAnalyzer />
      </main>
    </>
  );
}
