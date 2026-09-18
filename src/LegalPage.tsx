import React from 'react';
import { getLegalPageContent, translate, useLanguage } from './i18n';
import { AppShell } from './components/AppShell';
import { ShieldCheck } from 'lucide-react';
import './components/InfoAndAchievements.css';

type LegalKind = 'privacy' | 'terms';

export function LegalPage({ kind }: { kind: LegalKind }) {
  const language = useLanguage();
  const page = getLegalPageContent(kind, language);

  return (
    <AppShell title={page.title}>
      <div className="info-page-card">
        <header style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#ffffff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={26} color="#f59e0b" />
            <span>{page.title}</span>
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '0.92rem', marginTop: 8, lineHeight: 1.6 }}>
            {page.intro}
          </p>
        </header>

        {/* 章节列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {page.sections.map((section) => (
            <section
              key={section.heading}
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <h2 style={{ fontSize: '1.05rem', color: '#fcd34d', margin: '0 0 8px 0', fontWeight: 800 }}>
                {section.heading}
              </h2>
              <p style={{ color: '#cbd5e1', lineHeight: 1.8, margin: 0, fontSize: '0.9rem' }}>
                {section.body}
              </p>
            </section>
          ))}
        </div>

        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 8, color: '#94a3b8', fontSize: '0.82rem' }}>
          {translate('legal.version', language)}
        </footer>
      </div>
    </AppShell>
  );
}

export default LegalPage;
