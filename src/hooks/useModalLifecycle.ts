import { useLayoutEffect, type RefObject } from 'react';

/** Capture the trigger before showModal; restore it even when the dialog DOM is removed. */
export function useModalLifecycle(ref: RefObject<HTMLDialogElement>, open: boolean) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      queueMicrotask(() => { if (trigger?.isConnected) trigger.focus(); });
    };
  }, [ref, open]);
}
