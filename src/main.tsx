/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initializePwa } from './utils/pwa';
import { loadPreferences } from './utils/preferences';
import { getLanguage, initializeLanguage, translate } from './i18n';
import './index.css';
import './utility.css';

initializePwa();
const initialLanguage = loadPreferences().language;
initializeLanguage(initialLanguage);
document.documentElement.lang = initialLanguage;
const Root = location.pathname.startsWith('/admin')
  ? React.lazy(() => import('./AdminApp').then((m) => ({ default: m.AdminApp })))
  : location.pathname.startsWith('/duel')
  ? React.lazy(() => import('./DuelApp').then((m) => ({ default: m.DuelApp })))
  : location.pathname.startsWith('/auction')
  ? React.lazy(() => import('./AuctionApp').then((m) => ({ default: m.AuctionApp })))
  : location.pathname.startsWith('/challenge')
  ? React.lazy(() => import('./ChallengeApp').then((m) => ({ default: m.ChallengeApp })))
  : location.pathname.startsWith('/survivor')
  ? React.lazy(() => import('./SurvivorApp').then((m) => ({ default: m.SurvivorApp })))
  : location.pathname.startsWith('/tournament')
  ? React.lazy(() => import('./TournamentApp').then((m) => ({ default: m.TournamentApp })))
  : location.pathname.startsWith('/share/')
  ? React.lazy(() => import('./SharePage'))
  : location.pathname.startsWith('/tutorial')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="tutorial" /> })))
  : location.pathname.startsWith('/rules')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="rules" /> })))
  : location.pathname.startsWith('/achievements')
  ? React.lazy(() => import('./AchievementsPage'))
  : location.pathname.startsWith('/maintenance')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="maintenance" /> })))
  : location.pathname.startsWith('/updates')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="updates" /> })))
  : location.pathname.startsWith('/history')
  ? React.lazy(() => import('./StandalonePanelPage').then((m) => ({ default: () => <m.StandalonePanelPage panel="history" /> })))
  : location.pathname.startsWith('/ranking')
  ? React.lazy(() => import('./StandalonePanelPage').then((m) => ({ default: () => <m.StandalonePanelPage panel="ranking" /> })))
  : location.pathname.startsWith('/profile')
  ? React.lazy(() => import('./StandalonePanelPage').then((m) => ({ default: () => <m.StandalonePanelPage panel="profile" /> })))
  : location.pathname.startsWith('/settings')
  ? React.lazy(() => import('./StandaloneSettingsPage'))
  : location.pathname.startsWith('/report')
  ? React.lazy(() => import('./StandaloneReportPage'))
  : location.pathname.startsWith('/privacy')
  ? React.lazy(() => import('./LegalPage').then((m) => ({ default: () => <m.LegalPage kind="privacy" /> })))
  : location.pathname.startsWith('/terms')
  ? React.lazy(() => import('./LegalPage').then((m) => ({ default: () => <m.LegalPage kind="terms" /> })))
  : location.pathname.startsWith('/network')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="network" /> })))
  : location.pathname.startsWith('/room-expired')
  ? React.lazy(() => import('./InfoPage').then((m) => ({ default: () => <m.InfoPage kind="room-expired" /> })))
  : import.meta.env.DEV && new URLSearchParams(location.search).has('asset-review')
  ? React.lazy(() => import('./AssetReview'))
  : React.lazy(() => import('./App').then((module) => ({ default: module.App })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<p className="app-loading" role="status">{translate('app.loading', getLanguage())}</p>}><Root /></React.Suspense>
  </React.StrictMode>
);
