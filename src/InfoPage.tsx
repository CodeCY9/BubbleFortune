import React from 'react';
import { getInfoPageContent, translate, useLanguage } from './i18n';
import { AppShell } from './components/AppShell';
import { BookOpen, Shield, HelpCircle } from 'lucide-react';
import './components/InfoAndAchievements.css';

type InfoKind = 'tutorial' | 'rules' | 'achievements' | 'maintenance' | 'updates' | 'network' | 'room-expired';

export function InfoPage({ kind }: { kind: InfoKind }) {
  const language = useLanguage();
  const page = getInfoPageContent(kind, language);

  return (
    <AppShell title={page.title}>
      <div className="info-page-card">
        <header style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#ffffff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={24} color="#f59e0b" />
            <span>{page.title}</span>
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '0.92rem', marginTop: 8, lineHeight: 1.6 }}>
            {page.intro}
          </p>
        </header>

        {/* 条目卡片流 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {page.items.map((item, index) => (
            <div key={index} className="info-item-card">
              <span className="info-bullet-point" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* 底部法律条款直达 */}
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 8 }}>
          <nav
            aria-label={translate('common.legalNav', language)}
            style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.85rem' }}
          >
            <a href="/privacy" style={{ color: '#c4b5fd', textDecoration: 'none' }}>
              {translate('common.privacy', language)}
            </a>
            <span>·</span>
            <a href="/terms" style={{ color: '#c4b5fd', textDecoration: 'none' }}>
              {translate('common.terms', language)}
            </a>
          </nav>
        </footer>
      </div>
    </AppShell>
  );
}

export default InfoPage;
