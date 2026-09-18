import React, { useCallback, useMemo } from 'react';
import { ReportDialog } from './components/ReportDialog';
import { translate, useLanguage } from './i18n';

function navigateBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.assign('/');
  }
}

/** Deep-link entry for report links shared from history and result pages. */
export function StandaloneReportPage() {
  const language = useLanguage();
  const target = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const targetType = (params.get('type') || '').trim();
    const targetId = (params.get('id') || '').trim();
    const description = (params.get('description') || '').trim();
    return targetType && targetId
      ? { targetType, targetId, description: description || undefined }
      : null;
  }, []);
  const close = useCallback(() => navigateBack(), []);

  if (!target) {
    return (
      <main className="standalone-panel-page" aria-label={translate('report.title', language)}>
        <section
          role="alert"
          style={{
            maxWidth: 640,
            margin: '0 auto',
            padding: '32px 24px',
            color: 'var(--text-primary)',
            textAlign: 'center',
          }}
        >
          <h1>{translate('report.title', language)}</h1>
          <p>{translate('report.invalidTarget', language)}</p>
          <button type="button" onClick={close} style={{ minHeight: 44, padding: '8px 18px' }}>
            {translate('report.done', language)}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="standalone-panel-page" aria-label={translate('report.title', language)}>
      <ReportDialog
        isOpen
        onClose={close}
        targetType={target.targetType}
        targetId={target.targetId}
        targetDescription={target.description}
      />
    </main>
  );
}

export default StandaloneReportPage;
