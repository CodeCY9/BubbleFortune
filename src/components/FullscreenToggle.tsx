import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { translate, useLanguage } from '../i18n';

export function FullscreenToggle({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be denied by the browser or embedding page.
    }
  };

  const label = translate('settings.fullscreen.aria', language);
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={label}
      title={label}
      style={compact ? { minHeight: 40, minWidth: 40, padding: 8 } : undefined}
    >
      {isFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
      <span className="sr-only">
        {isFullscreen ? translate('settings.fullscreen.exit', language) : translate('settings.fullscreen.enter', language)}
      </span>
    </button>
  );
}

export default FullscreenToggle;
