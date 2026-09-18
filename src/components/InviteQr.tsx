import React, { useState } from 'react';
import { translate, useLanguage } from '../i18n';

export const InviteQr: React.FC<{ url: string; label?: string }> = ({ url, label }) => {
  const language = useLanguage();
  const resolvedLabel = label || translate('share.qr.show', language);
  const [failed, setFailed] = useState(false);
  const qrUrl = `https://quickchart.io/qr?size=180&text=${encodeURIComponent(url)}`;
  return (
    <details style={{ marginTop: '10px' }}>
      <summary style={{ cursor: 'pointer', color: '#c4b5fd', fontSize: '.8rem' }}>{resolvedLabel}</summary>
      <div style={{ marginTop: '8px', display: 'grid', placeItems: 'center', gap: '6px' }}>
        {!failed ? <img src={qrUrl} alt={translate('share.qr.alt', language)} width={180} height={180} loading="lazy" onError={() => setFailed(true)} style={{ background: '#fff', padding: '8px', borderRadius: '8px' }} /> : <span style={{ color: '#fca5a5', fontSize: '.78rem' }}>{translate('share.qr.error', language)}</span>}
        <a href={url} target="_blank" rel="noreferrer" style={{ color: '#94a3b8', fontSize: '.75rem', wordBreak: 'break-all' }}>{url}</a>
      </div>
    </details>
  );
};
