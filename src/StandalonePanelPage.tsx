import React, { useCallback } from 'react';
import { HistoryModal } from './components/HistoryModal';
import { RankingModal } from './components/RankingModal';
import { ProfileSummaryModal } from './components/ProfileSummaryModal';
import { AppShell } from './components/AppShell';
import { translate, useLanguage } from './i18n';

export type StandalonePanel = 'history' | 'ranking' | 'profile';

/**
 * Deep-link entry for the GDD's history, ranking and profile pages.
 * Wrapped with universal AppShell to eliminate isolated black screen on standalone visits.
 */
export function StandalonePanelPage({ panel }: { panel: StandalonePanel }) {
  const language = useLanguage();
  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  }, []);

  const titleMap: Record<StandalonePanel, string> = {
    history: translate('history.title', language) || '对局历史',
    ranking: translate('ranking.title', language) || '天梯排行榜',
    profile: translate('profile.title', language) || '个人档案',
  };

  const title = titleMap[panel];

  return (
    <AppShell title={title} onBack={close}>
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
        {panel === 'history' && <HistoryModal isOpen onClose={close} />}
        {panel === 'ranking' && <RankingModal isOpen onClose={close} />}
        {panel === 'profile' && <ProfileSummaryModal isOpen onClose={close} />}
      </div>
    </AppShell>
  );
}

export default StandalonePanelPage;
