'use client';
import { useEffect, useRef } from 'react';

import { AlertDetail } from './AlertDetail';

/** Native modal supplies focus trapping, inert background, Escape and focus restoration. */
export function AlertDialog(props: Parameters<typeof AlertDetail>[0]) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('#alert-detail-title')?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      const target = trigger instanceof HTMLElement && trigger.isConnected ? trigger : document.querySelector<HTMLElement>('[data-testid="alert-item"]');
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog?.open && !dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>('#alert-detail-title')?.focus({ preventScroll: true });
  }, [props.alert.status]);
  const controls = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), audio[controls]') ?? [])].filter((element) => element.getClientRects().length > 0);
  return <dialog ref={ref} className="detail-overlay" aria-label="Карточка тревоги" onCancel={(event) => { event.preventDefault(); props.onClose(); }}>
    <span className="sr-only" tabIndex={0} onFocus={() => controls().at(-1)?.focus()} />
    <AlertDetail key={props.alert.id} {...props} />
    <span className="sr-only" tabIndex={0} onFocus={() => controls()[0]?.focus()} />
  </dialog>;
}
