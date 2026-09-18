import React, { useState, useEffect } from 'react';
import {
  User,
  Users,
  Sparkles,
  Shield,
  Info,
  ArrowRight,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  Settings,
  History,
  Trophy,
  Swords,
  Flame,
  Award,
  MessageSquareQuote,
} from 'lucide-react';
import type { ConnectionStatus } from '../hooks/useGameState';
import type { AiType } from '../../packages/protocol/src/types';
import { getAiPresentation, translateLobby, useLanguage } from '../i18n';
import './RoomLobby.css';

interface AiOption {
  type: AiType;
  avatar: string;
}

const AI_OPTIONS: readonly AiOption[] = [
  {
    type: 'conservative',
    avatar: '/assets/character_banker_thinking.png',
  },
  {
    type: 'aggressive',
    avatar: '/assets/character_banker_confident.png',
  },
  {
    type: 'cold',
    avatar: '/assets/character_banker_sinister.png',
  },
  {
    type: 'inducement',
    avatar: '/assets/character_banker_explaining.png',
  },
  {
    type: 'crazy',
    avatar: '/assets/character_banker_pointing.png',
  },
] as const;

const AI_QUOTES: Record<AiType, string> = {
  conservative: '“稳健至上，任何超出数学期望的盲目冒险都是致命的。”',
  aggressive: '“在真正的资本压力面前，你只剩妥协，还是孤注一掷？”',
  cold: '“数字没有温度。每一轮开箱的胜率，都在我的冷酷算计之中。”',
  inducement: '“这是一个绝妙的收购报价，懂得见好就收才是真正的赢家。”',
  crazy: '“命运的大奖就藏在下一只箱子里，你敢跟我一路赌到底吗？！”',
};

interface RoomLobbyProps {
  mode?: 'classic' | 'challenge';
  onStartGame?: (aiType: AiType) => void;
  onStartSinglePlayer?: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onOpenRanking?: () => void;
  onOpenProfile?: () => void;
  connectionStatus?: ConnectionStatus;
  onRetryConnection?: () => void;
  isPending?: boolean;
  errorMessage?: string | null;
}

export const RoomLobby: React.FC<RoomLobbyProps> = ({
  mode = 'classic',
  onStartGame,
  onStartSinglePlayer,
  onOpenSettings,
  onOpenHistory,
  onOpenRanking,
  onOpenProfile,
  connectionStatus = 'disconnected',
  onRetryConnection,
  isPending = false,
  errorMessage = null,
}) => {
  const challengeMode = mode === 'challenge';
  const [activeTab, setActiveTab] = useState<'MODE' | 'RULES'>('MODE');
  const [selectedAi, setSelectedAi] = useState<AiType>('conservative');
  const language = useLanguage();
  const text = (key: Parameters<typeof translateLobby>[0]) => translateLobby(key, language);

  const handleStartClassic = () => {
    if (onStartGame) {
      onStartGame(selectedAi);
    } else if (onStartSinglePlayer) {
      onStartSinglePlayer();
    }
  };

  // 全局桌面端快捷键支持: 数字键 1-5 切换 AI 对手，Enter 快速开局
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (activeTab === 'MODE' && !challengeMode) {
        if (e.key === '1') setSelectedAi('conservative');
        else if (e.key === '2') setSelectedAi('aggressive');
        else if (e.key === '3') setSelectedAi('cold');
        else if (e.key === '4') setSelectedAi('inducement');
        else if (e.key === '5') setSelectedAi('crazy');
        else if (e.key === 'Enter' && !isPending) {
          e.preventDefault();
          handleStartClassic();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, challengeMode, isPending, selectedAi]);

  return (
    <div className="lobby-viewport">
      <div className="lobby-inner-container">
        {/* 1. 顶部大厅导航与品牌状态栏 (Lobby Topbar) */}
        <header className="lobby-topbar">
          <div className="lobby-brand-group">
            <h1 className="lobby-logo-title">
              <Sparkles size={28} color="#f59e0b" />
              <span>BubbleFortune</span>
            </h1>
            <div className="lobby-brand-desc">
              <div className="lobby-tagline">{text('tagline')}</div>
              <div className="lobby-virtual-badge">{text('virtualNotice')}</div>
            </div>
          </div>

          <div className="lobby-actions-group">
            {/* 网络连接状态 */}
            <div className="lobby-network-pill">
              {connectionStatus === 'connected' && (
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Wifi size={14} /> {text('serverReady')}
                </span>
              )}
              {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
                <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <RefreshCw size={14} className="spin" />
                  {connectionStatus === 'reconnecting' ? text('reconnecting') : text('connecting')}
                </span>
              )}
              {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
                <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <WifiOff size={14} />
                  {connectionStatus === 'failed' ? text('failed') : text('disconnected')}
                  {onRetryConnection && (
                    <button
                      type="button"
                      onClick={onRetryConnection}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#f87171',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      {text('retry')}
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* 顶栏快捷入口 */}
            {onOpenRanking && (
              <button
                type="button"
                className="lobby-quick-btn"
                onClick={onOpenRanking}
                aria-label={text('rankingAria')}
              >
                <Trophy size={16} color="#fcd34d" />
                <span>{text('ranking')}</span>
              </button>
            )}

            {onOpenProfile && (
              <button
                type="button"
                className="lobby-quick-btn"
                onClick={onOpenProfile}
                aria-label={text('profileAria')}
              >
                <User size={16} color="#38bdf8" />
                <span>{text('profile')}</span>
              </button>
            )}

            {onOpenHistory && (
              <button
                type="button"
                className="lobby-quick-btn"
                onClick={onOpenHistory}
                aria-label={text('historyAria')}
              >
                <History size={16} color="#67e8f9" />
                <span>{text('history')}</span>
              </button>
            )}

            {onOpenSettings && (
              <button
                type="button"
                className="lobby-quick-btn"
                onClick={onOpenSettings}
                aria-label={text('settingsAria')}
              >
                <Settings size={16} color="#fcd34d" />
                <span>{text('settings')}</span>
              </button>
            )}
          </div>
        </header>

        {/* 错误提示横幅 */}
        {errorMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: '#fca5a5',
              padding: '12px 18px',
              borderRadius: '12px',
              fontSize: '0.9rem',
            }}
          >
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 2. Tab 切换栏 (模式选择 vs 玩法指南) */}
        <div className="lobby-tab-bar">
          <button
            type="button"
            className={`lobby-tab-btn ${activeTab === 'MODE' ? 'active' : ''}`}
            onClick={() => setActiveTab('MODE')}
          >
            <Sparkles size={16} />
            <span>{text('modeTab')}</span>
          </button>
          <button
            type="button"
            className={`lobby-tab-btn ${activeTab === 'RULES' ? 'active' : ''}`}
            onClick={() => setActiveTab('RULES')}
          >
            <Info size={16} />
            <span>{text('rulesTab')}</span>
          </button>
        </div>

        {/* 3. 核心内容区 */}
        {activeTab === 'MODE' ? (
          <div className="lobby-main-grid">
            {/* 左侧主展位：经典单人博弈 (Hero Showcase) */}
            <section className="lobby-hero-card">
              <div>
                <div className="lobby-hero-header">
                  <div className="lobby-hero-title-area">
                    <div className="lobby-hero-icon-box">
                      <User size={28} />
                    </div>
                    <div>
                      <div className="lobby-hero-title">
                        {challengeMode ? text('challengeTitle') : text('classicTitle')}
                      </div>
                      <div className="lobby-hero-desc">
                        {challengeMode ? text('challengeDescription') : text('classicDescription')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI 资本家对手席 (Banker's Lounge) */}
                {!challengeMode && (
                  <div className="ai-lounge-box" style={{ marginTop: '20px' }}>
                    <div className="ai-lounge-legend">
                      <Sparkles size={15} />
                      <span>{text('aiLegend')}</span>
                    </div>

                    <div className="ai-cards-grid">
                      {AI_OPTIONS.map((opt, index) => {
                        const isSelected = selectedAi === opt.type;
                        const pres = getAiPresentation(opt.type, language);
                        return (
                          <label
                            key={opt.type}
                            className={`ai-character-card ${isSelected ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name="aiTypeChoice"
                              value={opt.type}
                              checked={isSelected}
                              onChange={() => setSelectedAi(opt.type)}
                              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                            />
                            <div className="ai-avatar-wrap">
                              <img
                                src={opt.avatar}
                                alt={pres.name}
                                className="ai-avatar-img"
                              />
                            </div>
                            <div className="ai-info-col">
                              <div className="ai-name-row">
                                <span className="ai-name-text">{pres.name}</span>
                                <span className="ai-tag-pill">{pres.tag}</span>
                                <kbd className="kbd-hint">{index + 1}</kbd>
                              </div>
                              <div className="ai-desc-text">{pres.desc}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {/* 当前选中的 AI 资本家谈判风格语录 */}
                    <div className="ai-quote-bubble" style={{ marginTop: '12px' }}>
                      <MessageSquareQuote size={18} color="#fcd34d" style={{ flexShrink: 0 }} />
                      <span>{AI_QUOTES[selectedAi]}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 经典单人博弈开始按钮 */}
              <div className="lobby-hero-cta">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleStartClassic}
                  className="btn-primary lobby-start-btn"
                >
                  <span>
                    {isPending ? text('creating') : challengeMode ? text('startChallenge') : text('startGame')}
                  </span>
                  <kbd className="kbd-hint" style={{ background: 'rgba(0,0,0,0.25)', color: '#000', borderColor: 'transparent', fontWeight: 700 }}>
                    Enter ⏎
                  </kbd>
                  <ArrowRight size={20} />
                </button>
              </div>
            </section>

            {/* 右侧副展位：多元玩法与多人竞技矩阵 (Modes Hub) */}
            <section className="lobby-modes-hub">
              <div className="lobby-hub-header">
                <div className="lobby-hub-title">
                  <Swords size={18} color="#fcd34d" />
                  <span>进阶与多人玩法矩阵</span>
                </div>
                <div className="lobby-hub-subtitle">多元机制 · 实时竞技</div>
              </div>

              {/* 1. 单人挑战模式 */}
              {!challengeMode && (
                <div className="lobby-mode-card mode-card-challenge">
                  <div className="lobby-mode-left">
                    <div
                      className="lobby-mode-icon"
                      style={{ background: 'rgba(34, 211, 238, 0.2)', color: '#67e8f9' }}
                    >
                      <Shield size={24} />
                    </div>
                    <div className="lobby-mode-meta">
                      <div className="lobby-mode-title-row">
                        <span className="lobby-mode-title">{text('challengeTitle')}</span>
                        <span
                          className="lobby-mode-badge"
                          style={{ background: 'rgba(34, 211, 238, 0.2)', color: '#a5f3fc' }}
                        >
                          单人挑战
                        </span>
                      </div>
                      <div className="lobby-mode-desc">{text('challengeDescription')}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary lobby-mode-btn"
                    onClick={() => window.location.assign('/challenge')}
                  >
                    {text('startChallenge')}
                  </button>
                </div>
              )}

              {/* 2. 箱王生存战 (2~6人) */}
              <div className="lobby-mode-card mode-card-survivor">
                <div className="lobby-mode-left">
                  <div
                    className="lobby-mode-icon"
                    style={{ background: 'rgba(192, 132, 252, 0.2)', color: '#d8b4fe' }}
                  >
                    <Users size={24} />
                  </div>
                  <div className="lobby-mode-meta">
                    <div className="lobby-mode-title-row">
                      <span className="lobby-mode-title">{text('survivorTitle')}</span>
                      <span
                        className="lobby-mode-badge"
                        style={{ background: 'rgba(192, 132, 252, 0.25)', color: '#e9d5ff' }}
                      >
                        {text('survivorBadge')}
                      </span>
                    </div>
                    <div className="lobby-mode-desc">{text('survivorDescription')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary lobby-mode-btn"
                  onClick={() => window.location.assign('/survivor')}
                >
                  {text('enterSurvivor')}
                </button>
              </div>

              {/* 3. 资本家对决 (2人对战) */}
              <div className="lobby-mode-card mode-card-duel">
                <div className="lobby-mode-left">
                  <div
                    className="lobby-mode-icon"
                    style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}
                  >
                    <Swords size={24} />
                  </div>
                  <div className="lobby-mode-meta">
                    <div className="lobby-mode-title-row">
                      <span className="lobby-mode-title">{text('duelTitle')}</span>
                      <span
                        className="lobby-mode-badge"
                        style={{ background: 'rgba(245, 158, 11, 0.25)', color: '#fcd34d' }}
                      >
                        {text('duelBadge')}
                      </span>
                    </div>
                    <div className="lobby-mode-desc">{text('duelDescription')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary lobby-mode-btn"
                  onClick={() => window.location.assign('/duel')}
                >
                  {text('enterDuel')}
                </button>
              </div>

              {/* 4. 多人资本竞拍 (3~8人) */}
              <div className="lobby-mode-card mode-card-auction">
                <div className="lobby-mode-left">
                  <div
                    className="lobby-mode-icon"
                    style={{ background: 'rgba(244, 114, 182, 0.2)', color: '#f472b6' }}
                  >
                    <Flame size={24} />
                  </div>
                  <div className="lobby-mode-meta">
                    <div className="lobby-mode-title-row">
                      <span className="lobby-mode-title">{text('auctionTitle')}</span>
                      <span
                        className="lobby-mode-badge"
                        style={{ background: 'rgba(244, 114, 182, 0.25)', color: '#fbcfe8' }}
                      >
                        {text('auctionBadge')}
                      </span>
                    </div>
                    <div className="lobby-mode-desc">{text('auctionDescription')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary lobby-mode-btn"
                  onClick={() => window.location.assign('/auction')}
                >
                  {text('enterAuction')}
                </button>
              </div>

              {/* 5. 锦标赛 (Tournament) */}
              <div className="lobby-mode-card mode-card-tournament">
                <div className="lobby-mode-left">
                  <div
                    className="lobby-mode-icon"
                    style={{ background: 'rgba(129, 140, 248, 0.2)', color: '#a5b4fc' }}
                  >
                    <Award size={24} />
                  </div>
                  <div className="lobby-mode-meta">
                    <div className="lobby-mode-title-row">
                      <span className="lobby-mode-title">{text('tournamentTitle')}</span>
                      <span
                        className="lobby-mode-badge"
                        style={{ background: 'rgba(129, 140, 248, 0.25)', color: '#c7d2fe' }}
                      >
                        {text('tournamentBadge')}
                      </span>
                    </div>
                    <div className="lobby-mode-desc">{text('tournamentDescription')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary lobby-mode-btn"
                  onClick={() => window.location.assign('/tournament')}
                >
                  {text('enterTournament')}
                </button>
              </div>
            </section>
          </div>
        ) : (
          /* 玩法规则指南视图 */
          <div className="rules-guide-box">
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#fcd34d', margin: 0 }}>
                BubbleFortune 官方对决规则指南
              </h2>
              <p style={{ color: '#9ca3af', fontSize: '0.88rem', marginTop: '6px' }}>
                经典 26 箱博弈，暗中锁定理性与欲望的极限角逐
              </p>
            </div>

            <div className="rules-cards-grid">
              {/* Step 1 */}
              <div className="rule-step-card">
                <div
                  className="rule-step-badge"
                  style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}
                >
                  1
                </div>
                <div className="rule-step-title">{text('rulesStep1')}</div>
                <div className="rule-step-body">{text('rulesStep1Body')}</div>
              </div>

              {/* Step 2 */}
              <div className="rule-step-card">
                <div
                  className="rule-step-badge"
                  style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}
                >
                  2
                </div>
                <div className="rule-step-title">{text('rulesStep2')}</div>
                <div className="rule-step-body">{text('rulesStep2Body')}</div>
              </div>

              {/* Step 3 */}
              <div className="rule-step-card">
                <div
                  className="rule-step-badge"
                  style={{ background: 'rgba(103, 232, 249, 0.2)', color: '#67e8f9' }}
                >
                  3
                </div>
                <div className="rule-step-title">{text('rulesStep3')}</div>
                <div className="rule-step-body">{text('rulesStep3Body')}</div>
              </div>
            </div>
          </div>
        )}

        {/* 4. 底部导航与合规链接 (Lobby Footer) */}
        <footer className="lobby-footer">
          <nav aria-label={text('helpNav')} className="lobby-footer-nav">
            <a href="/tutorial" className="lobby-footer-link">{text('tutorial')}</a>
            <span>·</span>
            <a href="/rules" className="lobby-footer-link">{text('rules')}</a>
            <span>·</span>
            <a href="/achievements" className="lobby-footer-link">{text('achievements')}</a>
            <span>·</span>
            <a href="/updates" className="lobby-footer-link">{text('updates')}</a>
            <span>·</span>
            <a href="/maintenance" className="lobby-footer-link">{text('maintenance')}</a>
            <span>·</span>
            <a href="/network" className="lobby-footer-link">{text('network')}</a>
            <span>·</span>
            <a href="/room-expired" className="lobby-footer-link">{text('roomExpired')}</a>
          </nav>

          <nav aria-label={text('rulesAria')} className="lobby-footer-nav" style={{ fontSize: '0.74rem' }}>
            <a href="/privacy" className="lobby-footer-link">{text('privacy')}</a>
            <span>·</span>
            <a href="/terms" className="lobby-footer-link">{text('terms')}</a>
            <span>·</span>
            <a href="/rules" className="lobby-footer-link">{text('gameRules')}</a>
          </nav>
        </footer>
      </div>
    </div>
  );
};
