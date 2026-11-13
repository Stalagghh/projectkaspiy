'use client';
import { AudioLines, PawPrint, Radar } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { formatClock } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

const SECTIONS = [
  { href: '/', label: 'Обстановка', Icon: Radar },
  { href: '/forecast', label: 'Прогноз', Icon: PawPrint },
  { href: '/audio', label: 'Анализ аудио', Icon: AudioLines },
] as const;

/** Product mark: a shield with two waves. */
function BrandMark() {
  return (
    <svg className="brand-mark" width="30" height="32" viewBox="0 0 30 32" fill="none" aria-hidden="true">
      <path
        d="M15 1.5 27.5 6v9.2c0 7-4.9 12.4-12.5 15.3C7.400 27.6 2.500 22.200 2.500 15.200V6L15 1.500Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M7.500 13.500c2.500-2 5-2 7.500 0s5 2 7.500 0M8.500 19c2.200-1.700 4.300-1.700 6.500 0s4.300 1.700 6.500 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Moscow time: every timestamp in the interface uses it. Empty until the browser clock is read. */
function Clock() {
  const now = useNow();
  return (
    <span className="clock num" aria-label="Московское время">
      {now === null ? '--:--:--' : formatClock(new Date(now).toISOString())}
      <small>МСК</small>
    </span>
  );
}

/** Header shared by every page: product name, navigation and the page's own controls (children). */
export function TopBar({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Эко-щит Каспия — на главный экран">
        <BrandMark />
        <span className="brand-text">
          <span className="brand-title">Эко-щит Каспия</span>
          <span className="brand-sub">Аграханский заказник</span>
        </span>
      </Link>
      <nav className="nav" aria-label="Разделы">
        {SECTIONS.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
            <Icon size={17} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="topbar-tools">
        {children}
        <Clock />
      </div>
    </header>
  );
}
