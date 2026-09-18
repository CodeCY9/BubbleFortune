import { useState, useSyncExternalStore } from 'react';
import { subscribePwa, getPwaState, installPwa, applyPwaUpdate } from '../utils/pwa';
import { translate, useLanguage } from '../i18n';

export function PwaControls({ activeGame }: { activeGame: boolean }) {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const language = useLanguage();
  return <section className="pwa-controls" aria-label={translate('pwa.aria', language)}>
    <h3>{translate('pwa.aria', language)}</h3>
    {state.offline && <p role="status">{translate('pwa.offline', language)}</p>}
    {state.canInstall ? <button type="button" className="btn-secondary" onClick={installPwa}>{translate('pwa.install', language)}</button>
      : <p>{translate('pwa.installHint', language)}</p>}
    {state.updateReady && <div role="status"><p>{activeGame ? translate('pwa.updateAfterGame', language) : translate('pwa.updateReady', language)}</p>
      <button type="button" className="btn-primary" disabled={activeGame} onClick={() => applyPwaUpdate(activeGame)}>{translate('pwa.update', language)}</button></div>}
    {state.message && <p role="status">{state.message}</p>}
  </section>;
}

export function PwaNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useSyncExternalStore(subscribePwa, getPwaState);
  const language = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  if (!state.updateReady || dismissed) return null;
  return <aside className="pwa-notice" role="status"><span>{translate('pwa.notice', language)}</span>
    <button type="button" onClick={onOpenSettings}>{translate('pwa.viewUpdate', language)}</button>
    <button type="button" aria-label={translate('pwa.later', language)} onClick={() => setDismissed(true)}>{translate('pwa.later', language)}</button></aside>;
}
