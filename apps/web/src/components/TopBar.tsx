'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const SECTIONS = [
  { href: '/', label: 'Дашборд' },
  { href: '/forecast', label: 'Прогноз' },
  { href: '/audio', label: 'Анализ аудио' },
] as const;

/** Header shared by every page: product name, navigation and the page's own controls (children). */
export function TopBar({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <div style={{ display: 'grid' }}>
        <span className="brand-title">Эко-щит Каспия</span>
        <span className="brand-sub">Аграханский заказник</span>
      </div>
      <nav className="nav" aria-label="Разделы">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} aria-current={pathname === section.href ? 'page' : undefined}>
            {section.label}
          </Link>
        ))}
      </nav>
      <span className="topbar-spacer" />
      {children}
    </header>
  );
}
