'use client';
import { AudioLines, ChartNoAxesCombined, ChevronRight, FileChartColumn, LayoutDashboard, Map, MapPin, Radio, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { LiveIndicator } from '@/features/dashboard/LiveIndicator';
import { useLiveAlerts } from '@/features/dashboard/useLiveAlerts';

import { TopBar } from './TopBar';

const LiveContext = createContext<ReturnType<typeof useLiveAlerts> | null>(null);
export function useLiveData() {
  const value = useContext(LiveContext);
  if (!value) throw new Error('Live data requires AppShell');
  return value;
}

const ITEMS = [
  { href: '/', label: 'Мониторинг', Icon: LayoutDashboard },
  { href: '/#map-panel', label: 'Карта', Icon: Map },
  { href: '/audio', label: 'Аудиоанализ', Icon: AudioLines },
  { href: '/forecast', label: 'Прогноз', Icon: ChartNoAxesCombined },
  { href: '/#stations', label: 'Датчики', Icon: Radio },
];

export function AppShell({ children }: { children: ReactNode }) {
  const live = useLiveAlerts();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState('');
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return (
    <LiveContext.Provider value={live}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Перейти к содержимому</a>
        <TopBar menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)}>
          <LiveIndicator state={live.sseState} lastUpdateAt={live.lastUpdateAt} />
        </TopBar>
        <aside className="sidebar" data-open={menuOpen}>
          <nav id="site-navigation" aria-label="Разделы">
            <p className="nav-caption">Рабочее пространство</p>
            {ITEMS.map(({ href, label, Icon }) => {
              const current = pathname === '/' ? href === `/${hash}` : pathname === href;
              return (
                <Link key={href} href={href} className="nav-item" aria-label={label} title={label} aria-current={current ? 'page' : undefined} onClick={(event) => {
                  setMenuOpen(false);
                  const target = href.includes('#') ? href.slice(href.indexOf('#')) : '';
                  setHash(target);
                  if (pathname === '/' && target) {
                    event.preventDefault();
                    window.location.hash = target;
                    // Re-selecting a collapsed current section must reveal it too.
                    window.dispatchEvent(new HashChangeEvent('hashchange'));
                    document.getElementById(target.slice(1))?.scrollIntoView();
                  }
                }}>
                  <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                  <span>{label}</span>
                  {current && <ChevronRight size={16} className="nav-chevron" aria-hidden="true" />}
                </Link>
              );
            })}
            <div className="nav-unavailable">
              <button className="nav-item" type="button" disabled aria-describedby="reports-unavailable"><FileChartColumn size={21} strokeWidth={1.7} aria-hidden="true" />Отчёты</button>
              <small id="reports-unavailable">Раздел в разработке</small>
            </div>
          </nav>
          <div className="reserve-identity">
            <ShieldCheck size={32} strokeWidth={1.3} aria-hidden="true" />
            <span className="eyebrow">Под охраной природы</span>
            <strong>Аграханский<br />заказник</strong>
            <span><MapPin size={13} aria-hidden="true" /> Республика Дагестан</span>
            <p>Сохраняем Каспий.<br />Наблюдаем. Защищаем.</p>
          </div>
        </aside>
        <div className="workspace" id="main-content" tabIndex={-1}>{children}</div>
        <div className="sr-only" aria-live="polite" role="status">{live.announcement}</div>
        <div className="sr-only" aria-live="assertive">{live.criticalAnnouncement}</div>
      </div>
    </LiveContext.Provider>
  );
}
