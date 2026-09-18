import { useRef, useState, useCallback, useEffect } from 'react';

export function useDialog() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openDialog = useCallback(() => {
    previousFocusRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // Fallback if already open or not supported
        }
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        try {
          previousFocusRef.current.focus();
        } catch {}
      }
    }
  }, [isOpen]);

  // Handle native cancel event (Escape)
  const handleCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
      e.preventDefault();
      closeDialog();
    },
    [closeDialog]
  );

  return {
    dialogRef,
    isOpen,
    openDialog,
    closeDialog,
    handleCancel,
  };
}
