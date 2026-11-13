import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';

import './globals.css';

// IBM Plex Sans and IBM Plex Mono (PLAN.md section 14): one superfamily with full Cyrillic.
// The files ship with the app (SIL Open Font License, ./fonts/OFL-IBMPlex.txt), so neither the
// build nor the browser asks an outside server for fonts.
const plexSans = localFont({
  src: './fonts/IBMPlexSans-Variable.woff2',
  weight: '100 700',
  variable: '--font-plex-sans',
  display: 'swap',
});
const plexMono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexMono-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Эко-щит Каспия — Аграханский заказник',
  description: 'Пост инспектора: тревоги акустических буёв, датчики воды и карта заказника.',
};

export const viewport: Viewport = {
  themeColor: '#F3F5F7',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
