import React, { useEffect, useMemo, useState } from 'react';
import { ACHIEVEMENT_DEFINITIONS } from '../packages/protocol/src/achievements';
import { fetchAchievements, type AchievementItem } from './api/achievements';
import { ensureDuelGuestSession } from './api/duel';
import { getAchievementPresentation, translate, useLanguage } from './i18n';
import { AppShell } from './components/AppShell';
import { Trophy, Lock, Award, Sparkles, RefreshCw } from 'lucide-react';
import './components/InfoAndAchievements.css';

export function AchievementsPage() {
  const language = useLanguage();
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void ensureDuelGuestSession()
      .catch(() => undefined)
      .then(() => fetchAchievements())
      .then((result) => {
        if (!active) return;
        if (result.ok && result.data) {
          setItems(result.data.items);
          setStatus('ready');
        } else {
          setMessage(result.error?.message || translate('achievements.error', language));
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [language]);

  const unlocked = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const totalCount = ACHIEVEMENT_DEFINITIONS.length;
  const unlockedCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  const pageTitle = translate('achievements.title', language) || '成就图鉴';

  return (
    <AppShell title={pageTitle}>
      <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto' }}>
        {/* 顶部总览统计条 */}
        <section className="achievements-summary-banner">
          <div className="achievements-stats-col">
            <div className="achievements-stats-title">
              <Trophy size={24} color="#f59e0b" />
              <span>{pageTitle}</span>
            </div>
            <div className="achievements-stats-desc">
              {translate('achievements.intro', language)}
            </div>
          </div>

          <div className="achievements-progress-wrap">
            <div className="achievements-progress-text">
              <span>收集进度</span>
              <span>
                {unlockedCount} / {totalCount} ({progressPercent}%)
              </span>
            </div>
            <div className="achievements-progress-track">
              <div
                className="achievements-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </section>

        {status === 'loading' && (
          <div
            style={{
              padding: '36px',
              textAlign: 'center',
              color: '#fcd34d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <RefreshCw size={18} className="spin" />
            <span>{translate('achievements.loading', language)}</span>
          </div>
        )}

        {status === 'error' && (
          <div
            role="alert"
            style={{
              padding: '16px 20px',
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              marginBottom: 20,
            }}
          >
            {message}
          </div>
        )}

        {/* 成就奖牌 3 列自适应网格 */}
        <div className="achievements-grid">
          {ACHIEVEMENT_DEFINITIONS.map((definition) => {
            const achievement = unlocked.get(definition.id);
            const presentation = getAchievementPresentation(definition.id, language);
            const isUnlocked = Boolean(achievement);

            return (
              <article
                key={definition.id}
                className={`achievement-medal-card ${isUnlocked ? 'unlocked' : 'locked'}`}
              >
                <div className="achievement-card-top">
                  <div className="achievement-icon-box">
                    {isUnlocked ? <Award size={24} color="#fcd34d" /> : <Lock size={20} />}
                  </div>
                  <div className="achievement-info">
                    <div className="achievement-title-row">
                      <span className="achievement-name">{presentation.name}</span>
                      <span className="achievement-date">
                        {isUnlocked && achievement?.unlockedAt
                          ? `${translate('achievements.unlocked', language)} ${new Date(
                              achievement.unlockedAt,
                            ).toLocaleDateString(language)}`
                          : translate('achievements.locked', language)}
                      </span>
                    </div>
                    <p className="achievement-desc">{presentation.description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

export default AchievementsPage;
