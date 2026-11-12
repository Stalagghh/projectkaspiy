import { Info, OctagonExclamationPoint, TriangleExclamationPoint, type LucideIcon } from 'lucide-react';

import type { Severity } from '@ecoshield/contracts';

import { SEVERITY_LABEL } from '@/lib/labels';

export const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  info: Info,
  warning: TriangleExclamationPoint,
  critical: OctagonExclamationPoint,
};

/** Severity is never shown by color alone: icon + text + color. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className="sev" data-severity={severity}>
      <Icon size={16} aria-hidden="true" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
