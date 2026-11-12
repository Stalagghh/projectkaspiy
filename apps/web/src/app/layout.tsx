import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Эко-щит Каспия — Аграханский заказник',
  description: 'Панель инспектора: тревоги акустических буёв, датчики воды и карта заказника.',
};

export const viewport: Viewport = {
  themeColor: '#07111C',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
