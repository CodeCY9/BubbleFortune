import React, { useCallback, useEffect } from 'react';
import { SettingsDialog } from './components/SettingsDialog';
import { useDialog } from './hooks/useDialog';
import { usePreferences } from './hooks/usePreferences';
import { AppShell } from './components/AppShell';
import { translate, useLanguage } from './i18n';

/**
 * Deep-link entry for the GDD settings page.
 * Wrapped with universal AppShell to eliminate isolated black screen on standalone visits.
 */
export function StandaloneSettingsPage() {
  const language = useLanguage();
  const {
    preferences,
    effectiveQuality,
    effectiveReducedMotion,
    updatePreference,
    resetPreferences,
  } = usePreferences();
  const { dialogRef, isOpen, openDialog, closeDialog } = useDialog();

  useEffect(() => {
    openDialog();
  }, [openDialog]);

  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  }, []);

  const handleClose = useCallback(() => {
    closeDialog();
    close();
  }, [close, closeDialog]);

  const handleCancelAndClose = useCallback((event: React.SyntheticEvent<HTMLDialogElement, Event>) => {
    event.preventDefault();
    handleClose();
  }, [handleClose]);

  const title = translate('settings.title', language) || '游戏设置';

  return (
    <AppShell title={title} onBack={handleClose}>
      <div
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <SettingsDialog
          dialogRef={dialogRef}
          isOpen={isOpen}
          onClose={handleClose}
          onCancel={handleCancelAndClose}
          preferences={preferences}
          effectiveQuality={effectiveQuality}
          effectiveReducedMotion={effectiveReducedMotion}
          onUpdatePreference={updatePreference}
          onResetPreferences={resetPreferences}
          phase="MODE_SELECT"
          isGameOver
        />
      </div>
    </AppShell>
  );
}

export default StandaloneSettingsPage;
