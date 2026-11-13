import type { ReactNode } from 'react';

export function Panel({ title, id, action, children, className = '' }: { title: string; id: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overview-panel ${className}`} aria-labelledby={id}>
      <header className="panel-heading"><h2 id={id}>{title}</h2>{action}</header>
      {children}
    </section>
  );
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'healthy' | 'warning' | 'critical' }) {
  return <span className="status-badge" data-tone={tone}>{children}</span>;
}
