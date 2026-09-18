import { useState } from 'react';
import { createResultShare } from '../api/share';
import { createMultiplayerShare } from '../api/multiplayerShare';
import type { MultiplayerShareMode } from '../../packages/protocol/src/share';
import { createAuctionShare } from '../api/auction';
import { translate, useLanguage } from '../i18n';
import { Share2, Copy, ExternalLink, RefreshCw, Check } from 'lucide-react';

type ShareMode = MultiplayerShareMode | 'auction';

export function ShareControls({ resultId, mode }: { resultId: string; mode?: ShareMode }) {
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setMessage('');
    const result = mode === 'auction'
      ? await createAuctionShare(resultId)
      : mode
      ? await createMultiplayerShare(mode, resultId)
      : await createResultShare(resultId);
    if (result.ok && result.data) setLink(new URL(result.data.path, location.origin).href);
    else setMessage(result.error?.message || translate('share.retryError', language));
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setMessage(translate('share.copied', language));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage(translate('share.copyManual', language));
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'BubbleFortune', url: link });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage(translate('share.systemError', language));
    }
  };

  return (
    <section className="share-controls" aria-label={translate('share.controlsAria', language)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Share2 size={16} color="#facc15" />
        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fef08a' }}>
          {mode ? translate('share.publicMultiplayerShort', language) : translate('share.publicClassicShort', language)}
        </span>
      </div>

      {!link ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={create}
          style={{
            minHeight: '44px',
            padding: '10px 22px',
            borderRadius: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(180, 83, 9, 0.28))',
            border: '1px solid rgba(250, 204, 21, 0.45)',
            color: '#fef08a',
            fontWeight: 800,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          {busy ? <RefreshCw size={16} className="spin" /> : <Share2 size={16} />}
          <span>{busy ? translate('share.generating', language) : translate('share.create', language)}</span>
        </button>
      ) : (
        <>
          <label style={{ display: 'block', margin: '6px 0 2px', fontSize: '0.8rem', color: '#94a3b8' }}>
            {translate('share.link', language)}
            <input
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <div className="utility-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={copy}
              style={{
                minHeight: '42px',
                padding: '8px 18px',
                borderRadius: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.88rem',
              }}
            >
              {copied ? <Check size={16} color="#000" /> : <Copy size={16} color="#000" />}
              <span>{copied ? translate('share.copied', language) : translate('share.copy', language)}</span>
            </button>

            {typeof navigator.share === 'function' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={share}
                style={{ minHeight: '42px', padding: '8px 16px', borderRadius: '10px' }}
              >
                <Share2 size={16} />
                <span>{translate('share.system', language)}</span>
              </button>
            )}

            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
              }}
            >
              <ExternalLink size={15} />
              <span>{translate('share.preview', language)}</span>
            </a>
          </div>
        </>
      )}

      {message && (
        <p
          role="status"
          style={{
            marginTop: '10px',
            fontSize: '0.8rem',
            color: copied ? '#4ade80' : '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {copied && <Check size={14} />}
          <span>{message}</span>
        </p>
      )}
    </section>
  );
}
