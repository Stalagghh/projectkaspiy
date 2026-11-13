'use client';
import { Menu, Waves, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function TopBar({ children, menuOpen, onMenu }: { children: ReactNode; menuOpen: boolean; onMenu: () => void }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Эко-Щит Каспия — на главный экран">
        <Waves className="brand-mark" size={43} strokeWidth={2} aria-hidden="true" />
        <span className="brand-text">
          <span className="brand-title">Эко-Щит Каспия</span>
          <span className="brand-sub">Цифровая платформа охраны природы</span>
        </span>
      </Link>
      <div className="topbar-tools">{children}</div>
      <button className="btn btn-icon menu-toggle" type="button" onClick={onMenu} aria-expanded={menuOpen} aria-controls="site-navigation" aria-label={menuOpen ? 'Закрыть навигацию' : 'Открыть навигацию'}>
        {menuOpen ? <X size={23} aria-hidden="true" /> : <Menu size={23} aria-hidden="true" />}
      </button>
    </header>
  );
}
