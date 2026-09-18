import React, { useEffect, useState, useRef } from 'react';
import {
  History,
  X,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Shield,
  ShieldAlert,
  Calendar,
  Award,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import type { HistorySummaryItem, CompletedGameRecord } from '../../packages/protocol/src/types';
import { fetchGuestStatus, fetchHistoryList, fetchHistoryDetail } from '../api/history';
import type { SurvivorHistoryDetailResponse, SurvivorHistorySummaryItem } from '../../packages/protocol/src/survivor';
import { fetchSurvivorHistory, fetchSurvivorHistoryDetail } from '../api/survivor';
import type { TournamentHistoryDetailResponse, TournamentHistorySummaryItem } from '../../packages/protocol/src/tournament';
import { fetchTournamentHistory, fetchTournamentHistoryDetail, fetchTournamentReplay } from '../api/tournament';
import type { TournamentReplaySummary } from '../api/tournament';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import { describeAuditEvent } from '../utils/auditTimeline';
import { formatMoney } from '../types/game';
import { FairnessModal } from './FairnessModal';
import { ShareControls } from './ShareControls';
import { DuelHistoryPanel } from './duel/DuelHistoryPanel';
import { ReportDialog } from './ReportDialog';
import { fetchReplay, type ReplaySummary } from '../api/replay';
import type { AuctionHistoryDetailResponse, AuctionHistorySummaryItem } from '../../packages/protocol/src/auction';
import { ensureAuctionGuestSession, fetchAuctionHistoryList, fetchAuctionHistoryDetail } from '../api/auction';
import { ReplayViewer } from './ReplayViewer';
import { getAiPresentation, getLanguage, translate, useLanguage, type TranslationKey } from '../i18n';
import './ModalsRevamp.css';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 10;

const historyMessage = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
  Object.entries(replacements).reduce(
    (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
    translate(key, getLanguage()),
  );

const aiName = (type: string) => {
  try {
    return getAiPresentation(type as Parameters<typeof getAiPresentation>[0], getLanguage()).name;
  } catch {
    return type;
  }
};

const SurvivorHistoryPanel: React.FC = () => {
  const [items, setItems] = useState<SurvivorHistorySummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SurvivorHistoryDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replay, setReplay] = useState<ReplaySummary | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const loadList = (nextOffset = offset) => {
    setLoading(true);
    setError(null);
    fetchSurvivorHistory(PAGE_SIZE, nextOffset)
      .then((response) => {
        if (response.ok && response.data) {
          setItems(response.data.items);
          setTotal(response.data.total);
          setOffset(response.data.offset);
        } else {
          setError(response.error?.message || historyMessage('history.loadFailed'));
        }
      })
      .catch((cause) => setError(cause?.message || historyMessage('history.networkError')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadList(0); }, []);

  const loadDetail = (matchId: string) => {
    setDetailLoading(true);
    fetchSurvivorHistoryDetail(matchId)
      .then((response) => {
        if (response.ok && response.data) setDetail(response.data);
        else setError(response.error?.message || historyMessage('history.detailFailed'));
      })
      .catch((cause) => setError(cause?.message || historyMessage('history.networkError')))
      .finally(() => setDetailLoading(false));
  };

  if (detailLoading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>{historyMessage('history.survivor.detailLoading')}</div>;
  if (detail) {
    const me = detail.result.rankings.find((ranking) => ranking.seatId === detail.mySeatId);
    return (
      <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
        <button type="button" onClick={() => { setDetail(null); setReplay(null); }} style={{ minHeight: '44px', padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer' }}>{historyMessage('history.survivor.back')}</button>
        <div style={{ marginTop: '16px', padding: '16px', borderRadius: '14px', background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.25)' }}>
          <div style={{ color: '#67e8f9', fontSize: '.8rem', fontWeight: 700 }}>{historyMessage('history.survivor.title')}</div>
          <div style={{ marginTop: '6px', fontSize: '1.6rem', fontWeight: 900 }}>{me ? `${historyMessage('history.rank', { rank: me.rank })} · ${formatMoney(me.score)}` : historyMessage('history.survivor.completed')}</div>
          <div style={{ color: '#9ca3af', fontSize: '.8rem', marginTop: '4px' }}>{new Date(detail.completedAt).toLocaleString()} · {historyMessage('history.survivor.players', { count: detail.seats.length })}</div>
        </div>
        <h3 style={{ marginTop: '18px' }}>{historyMessage('history.survivor.finalRank')}</h3>
        <ol style={{ paddingLeft: '22px', lineHeight: 1.9 }}>
          {detail.result.rankings.map((ranking) => <li key={ranking.seatId}>{ranking.nickname} · {formatMoney(ranking.score)} {ranking.forfeited ? historyMessage('history.survivor.forfeited') : ''}</li>)}
        </ol>
        <h3>{historyMessage('history.survivor.timeline')}</h3>
        <ol style={{ paddingLeft: '22px', lineHeight: 1.8 }}>
          {detail.result.rounds.map((round) => <li key={round.roundIndex}>{historyMessage('history.survivor.round', { round: round.roundIndex, box: round.openedBoxId, amount: formatMoney(round.openedAmount) })}</li>)}
        </ol>
        <button type="button" onClick={() => { setReplayLoading(true); fetchReplay('survivor', detail.matchId).then((response) => { if (response.ok && response.data) setReplay(response.data); else setError(response.error?.message || historyMessage('history.replayError')); }).finally(() => setReplayLoading(false)); }} disabled={replayLoading} style={historySecondaryButton}>{replayLoading ? historyMessage('history.replayLoading') : historyMessage('history.replayView')}</button>
        {replay && <ReplayViewer title={historyMessage('history.survivor.replayTitle')} events={replay.events} />}
        <ShareControls resultId={detail.resultId} mode="survivor" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  return (
    <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>{historyMessage('history.survivor.loading')}</div> : error ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#fca5a5' }}>{error}<br /><button type="button" onClick={() => loadList(offset)} style={{ marginTop: '12px', minHeight: '44px', padding: '8px 14px' }}>{historyMessage('history.retry')}</button></div>
      ) : items.length === 0 ? <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>{historyMessage('history.survivor.empty')}</div> : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map((item) => <button key={item.resultId} type="button" onClick={() => loadDetail(item.matchId)} style={{ padding: '14px 16px', width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', borderRadius: '12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}><span>{new Date(item.completedAt).toLocaleString()} · {historyMessage('history.people', { count: item.totalPlayers })}</span><strong style={{ color: '#67e8f9' }}>{historyMessage('history.rank', { rank: item.myRank })} · {formatMoney(item.myScore)}</strong></div>
              <div style={{ marginTop: '4px', color: '#9ca3af', fontSize: '.78rem' }}>{historyMessage('history.survivor.detailHint')}</div>
            </button>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', color: '#9ca3af', fontSize: '.85rem' }}>
            <button type="button" disabled={offset === 0} onClick={() => loadList(Math.max(0, offset - PAGE_SIZE))}>{historyMessage('history.previous')}</button><span>{historyMessage('history.page', { current: currentPage, total: totalPages, count: total })}</span><button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => loadList(offset + PAGE_SIZE)}>{historyMessage('history.next')}</button>
          </div>
        </>
      )}
    </div>
  );
};

const TournamentHistoryPanel: React.FC = () => {
  const [items, setItems] = useState<TournamentHistorySummaryItem[]>([]);
  const [detail, setDetail] = useState<TournamentHistoryDetailResponse | null>(null);
  const [replay, setReplay] = useState<TournamentReplaySummary | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    fetchTournamentHistory().then((response) => {
      if (response.ok && response.data) setItems(response.data.items);
      else setError(response.error?.message || historyMessage('history.loadFailed'));
    }).catch((cause) => setError(cause?.message || historyMessage('history.networkError'))).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const loadReplay = () => {
    setReplayLoading(true);
    fetchTournamentReplay(detail?.tournamentId || '').then((response) => {
      if (response.ok && response.data) setReplay(response.data);
      else setError(response.error?.message || historyMessage('history.replayError'));
    }).catch((cause) => setError(cause?.message || historyMessage('history.networkError'))).finally(() => setReplayLoading(false));
  };
  if (detail) return <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}><button type="button" onClick={() => { setDetail(null); setReplay(null); }} style={historySecondaryButton}>{historyMessage('history.tournament.back')}</button><h3>{historyMessage('history.tournament.title')}</h3><ol style={{ lineHeight: 1.9 }}>{detail.result.rankings.map((entry) => <li key={entry.seatId}>{entry.nickname} · {formatMoney(entry.score)} · {historyMessage('history.rank', { rank: entry.rank })}</li>)}</ol><h3>{historyMessage('history.tournament.matches')}</h3><ol style={{ lineHeight: 1.8 }}>{detail.result.matches.map((match) => <li key={match.matchId}>{match.matchId} · {match.winnerSeatId === null ? historyMessage('history.tournament.forfeited') : historyMessage('history.tournament.winner', { seat: match.winnerSeatId + 1 })}{match.tieBreakUsed ? historyMessage('history.tournament.tieBreak') : ''}</li>)}</ol><button type="button" onClick={loadReplay} disabled={replayLoading} style={historySecondaryButton}>{replayLoading ? historyMessage('history.replayLoading') : historyMessage('history.replayView')}</button>{replay && <ReplayViewer title={historyMessage('history.tournament.replayTitle')} events={replay.events} describe={(event) => historyMessage('history.tournament.replayDescribe', { seq: event.seq ?? '?', type: event.type || 'event' })} />}<ShareControls resultId={detail.resultId} mode="tournament" /></div>;
  return <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>{loading ? <div style={historyEmptyStyle}>{historyMessage('history.tournament.loading')}</div> : error ? <div style={{ ...historyEmptyStyle, color: '#fca5a5' }}>{error}<br /><button type="button" onClick={load} style={historySecondaryButton}>{historyMessage('history.retry')}</button></div> : items.length === 0 ? <div style={historyEmptyStyle}>{historyMessage('history.tournament.empty')}</div> : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{items.map((item) => <button key={item.resultId} type="button" onClick={() => fetchTournamentHistoryDetail(item.tournamentId).then((response) => { if (response.ok && response.data) setDetail(response.data); else setError(response.error?.message || historyMessage('history.tournament.detailFailed')); })} style={{ ...historySecondaryButton, textAlign: 'left', width: '100%' }}>{new Date(item.completedAt).toLocaleString()} · {historyMessage('history.rankOf', { rank: item.myRank, total: item.totalPlayers })}</button>)}</div>}</div>;
};

const AuctionHistoryPanel: React.FC = () => {
  const [items, setItems] = useState<AuctionHistorySummaryItem[]>([]);
  const [detail, setDetail] = useState<AuctionHistoryDetailResponse | null>(null);
  const [replay, setReplay] = useState<ReplaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    ensureAuctionGuestSession().catch(() => undefined).then(() => fetchAuctionHistoryList({ limit: PAGE_SIZE, offset: 0 })).then((response) => {
      if (response.ok && response.data) setItems(response.data.items);
      else setError(response.error?.message || historyMessage('history.auction.loadFailed'));
    }).catch(() => setError(historyMessage('history.networkError'))).finally(() => setLoading(false));
  }, []);
  if (detail) return <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}><button type="button" onClick={() => { setDetail(null); setReplay(null); }} style={historySecondaryButton}>{historyMessage('history.auction.back')}</button><h3>{historyMessage('history.auction.title')}</h3><ol style={{ lineHeight: 1.9 }}>{detail.result.rankings.map((entry) => <li key={entry.seatId}>{entry.nickname} · {formatMoney(entry.score)} · {historyMessage('history.rank', { rank: entry.rank })}</li>)}</ol><h3>{historyMessage('history.auction.rounds')}</h3><ol style={{ lineHeight: 1.8 }}>{detail.result.rounds.map((round) => <li key={round.roundIndex}>{historyMessage('history.auction.round', { round: round.roundIndex, outcome: round.outcomeType, profit: formatMoney(round.challengerProfit) })}</li>)}</ol><button type="button" onClick={() => fetchReplay('auction', detail.matchId).then((response) => { if (response.ok && response.data) setReplay(response.data); else setError(response.error?.message || historyMessage('history.replayError')); })} style={historySecondaryButton}>{historyMessage('history.replayView')}</button>{replay && <ReplayViewer title={historyMessage('history.auction.replayTitle')} events={replay.events} />}{error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}<ShareControls resultId={detail.resultId} mode="auction" /></div>;
  return <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>{loading ? <div style={historyEmptyStyle}>{historyMessage('history.auction.loading')}</div> : error ? <div style={{ ...historyEmptyStyle, color: '#fca5a5' }}>{error}</div> : items.length === 0 ? <div style={historyEmptyStyle}>{historyMessage('history.auction.empty')}</div> : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{items.map((item) => <button key={item.resultId} type="button" onClick={() => fetchAuctionHistoryDetail(item.matchId).then((response) => { if (response.ok && response.data) setDetail(response.data); else setError(response.error?.message || historyMessage('history.auction.detailFailed')); })} style={{ ...historySecondaryButton, textAlign: 'left', width: '100%' }}>{new Date(item.completedAt).toLocaleString()} · {historyMessage('history.rankOf', { rank: item.myRank, total: item.totalPlayers })} · {formatMoney(item.myScore)}</button>)}</div>}</div>;
};

const historyEmptyStyle: React.CSSProperties = { padding: '40px 20px', textAlign: 'center', color: '#9ca3af' };
const historySecondaryButton: React.CSSProperties = { minHeight: '44px', padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer' };

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose }) => {
  useLanguage();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const requestRef = useRef(0);
  const classicReplayRequestRef = useRef(0);
  useModalLifecycle(dialogRef, isOpen);

  const [activeTab, setActiveTab] = useState<'SINGLE' | 'DUEL' | 'AUCTION' | 'SURVIVOR' | 'TOURNAMENT'>('SINGLE');
  const [view, setView] = useState<'LIST' | 'DETAIL'>('LIST');
  const [offset, setOffset] = useState(0);

  // List state
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<HistorySummaryItem[]>([]);
  const [total, setTotal] = useState(0);

  // Detail state
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<CompletedGameRecord | null>(null);
  const [classicReplay, setClassicReplay] = useState<ReplaySummary | null>(null);
  const [classicReplayLoading, setClassicReplayLoading] = useState(false);
  const [classicReplayError, setClassicReplayError] = useState<string | null>(null);

  // Nested fairness modal
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ targetType: string; targetId: string; targetDescription?: string } | null>(null);

  const loadList = async (currentOffset = offset) => {
    const request = ++requestRef.current;
    setListLoading(true);
    setListError(null);
    const status = await fetchGuestStatus();
    if (request !== requestRef.current) return;
    if (!status.ok || !status.data?.enabled || !status.data.available) {
      setListError(status.ok && !status.data?.enabled ? historyMessage('history.dbDisabled') : status.error?.message || historyMessage('history.unavailable'));
      setListLoading(false);
      return;
    }
    if (!status.data.authenticated) {
      setItems([]); setTotal(0); setOffset(0); setListLoading(false);
      return;
    }
    fetchHistoryList({ limit: PAGE_SIZE, offset: currentOffset })
      .then((res) => {
        if (request !== requestRef.current) return;
        if (res.ok && res.data) {
          setItems(res.data.items);
          setTotal(res.data.total);
          setOffset(res.data.offset);
        } else {
          setListError(res.error?.message || historyMessage('history.loadFailed'));
        }
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        setListError(err?.message || historyMessage('history.networkError'));
      })
      .finally(() => {
        if (request === requestRef.current) setListLoading(false);
      });
  };

  const loadDetail = (resultId: string) => {
    const request = ++requestRef.current;
    setSelectedResultId(resultId);
    setView('DETAIL');
    setDetailLoading(true);
    setDetailError(null);
    setDetailRecord(null);
    setClassicReplay(null);
    setClassicReplayError(null);
    setClassicReplayLoading(false);
    classicReplayRequestRef.current++;

    fetchHistoryDetail(resultId)
      .then((res) => {
        if (request !== requestRef.current) return;
        if (res.ok && res.data) {
          setDetailRecord(res.data);
        } else {
          setDetailError(res.error?.message || historyMessage('history.detailFailed'));
        }
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        setDetailError(err?.message || historyMessage('history.networkError'));
      })
      .finally(() => {
        if (request === requestRef.current) setDetailLoading(false);
      });
  };

  const loadClassicReplay = async (resultId: string) => {
    const request = ++classicReplayRequestRef.current;
    setClassicReplayLoading(true);
    setClassicReplayError(null);
    const response = await fetchReplay('classic', resultId);
    if (request !== classicReplayRequestRef.current) return;
    if (response.ok && response.data) {
      setClassicReplay(response.data);
    } else {
      setClassicReplay(null);
      setClassicReplayError(response.error?.message || historyMessage('history.replayError'));
    }
    setClassicReplayLoading(false);
  };

  const handleTabChange = (tab: 'SINGLE' | 'DUEL' | 'AUCTION' | 'SURVIVOR' | 'TOURNAMENT') => {
    if (tab === activeTab) return;
    requestRef.current++;
    setIsFairnessOpen(false);
    setView('LIST');
    setSelectedResultId(null);
    setDetailRecord(null);
    setClassicReplay(null);
    setClassicReplayError(null);
    setClassicReplayLoading(false);
    classicReplayRequestRef.current++;
    setActiveTab(tab);
  };

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'SINGLE') {
        setView('LIST');
        loadList(0);
      }
    } else {
      setIsFairnessOpen(false);
      setView('LIST');
      setSelectedResultId(null);
      setDetailRecord(null);
      setClassicReplay(null);
      setClassicReplayError(null);
      setClassicReplayLoading(false);
      classicReplayRequestRef.current++;
    }
    return () => { requestRef.current++; };
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby="history-title"
        className="history-native-dialog"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{ padding: 0 }}
      >
        <div className="history-dialog-content">
          {/* Header */}
          <div className="history-header-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {activeTab === 'SINGLE' && view === 'DETAIL' && (
                <button
                  type="button"
                  onClick={() => { requestRef.current++; setView('LIST'); }}
                  aria-label={historyMessage('history.backList')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '44px',
                    minWidth: '44px',
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(139, 92, 246, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#c084fc',
                }}
              >
                <History size={20} />
              </div>
              <div>
                <h2 id="history-title" style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>
                  {activeTab === 'DUEL' ? historyMessage('history.title.duel') : activeTab === 'AUCTION' ? historyMessage('history.title.auction') : activeTab === 'SURVIVOR' ? historyMessage('history.title.survivor') : activeTab === 'TOURNAMENT' ? historyMessage('history.title.tournament') : view === 'LIST' ? historyMessage('history.title.list') : historyMessage('history.title.detail')}
                </h2>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                  {activeTab === 'DUEL' ? historyMessage('history.subtitle.duel') : activeTab === 'AUCTION' ? historyMessage('history.subtitle.auction') : activeTab === 'SURVIVOR' ? historyMessage('history.subtitle.survivor') : activeTab === 'TOURNAMENT' ? historyMessage('history.subtitle.tournament') : view === 'LIST' ? historyMessage('history.subtitle.list') : historyMessage('history.resultId', { id: detailRecord?.gameId || selectedResultId || '' })}
                </div>
              </div>
            </div>

            {/* Mode Tabs */}
            <div className="history-nav-tabs">
              <button
                type="button"
                onClick={() => handleTabChange('SINGLE')}
                className={`history-nav-tab-btn ${activeTab === 'SINGLE' ? 'active' : ''}`}
              >
                {historyMessage('history.tab.single')}
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('AUCTION')}
                className={`history-nav-tab-btn ${activeTab === 'AUCTION' ? 'active' : ''}`}
              >
                {historyMessage('history.tab.auction')}
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('SURVIVOR')}
                className={`history-nav-tab-btn ${activeTab === 'SURVIVOR' ? 'active' : ''}`}
              >
                {historyMessage('history.tab.survivor')}
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('TOURNAMENT')}
                className={`history-nav-tab-btn ${activeTab === 'TOURNAMENT' ? 'active' : ''}`}
              >
                {historyMessage('history.tab.tournament')}
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('DUEL')}
                className={`history-nav-tab-btn ${activeTab === 'DUEL' ? 'active' : ''}`}
              >
                {historyMessage('history.tab.duel')}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label={historyMessage('history.close')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '44px',
                minWidth: '44px',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          {activeTab === 'DUEL' ? (
            <DuelHistoryPanel />
          ) : activeTab === 'AUCTION' ? (
            <AuctionHistoryPanel />
          ) : activeTab === 'SURVIVOR' ? (
            <SurvivorHistoryPanel />
          ) : activeTab === 'TOURNAMENT' ? (
            <TournamentHistoryPanel />
          ) : (
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
            {view === 'LIST' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {listLoading ? (
                  <div
                    style={{
                      padding: '40px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      color: '#9ca3af',
                    }}
                  >
                    <RefreshCw size={24} className="spin" />
                    <span>{historyMessage('history.loading')}</span>
                  </div>
                ) : listError ? (
                  <div
                    style={{
                      padding: '24px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '12px',
                      textAlign: 'center',
                    }}
                  >
                    <AlertCircle size={24} color="#ef4444" style={{ margin: '0 auto 8px auto' }} />
                    <div style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{listError}</div>
                    <button
                      type="button"
                      onClick={() => loadList(offset)}
                      style={{
                        marginTop: '12px',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        cursor: 'pointer',
                        minHeight: '44px',
                      }}
                    >
                      {historyMessage('history.retry')}
                    </button>
                  </div>
                ) : items.length === 0 ? (
                  <div
                    style={{
                      padding: '40px 20px',
                      textAlign: 'center',
                      color: '#9ca3af',
                      background: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: '14px',
                      border: '1px dashed rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    <Award size={36} style={{ color: '#6b7280', margin: '0 auto 10px auto' }} />
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb' }}>
                      {historyMessage('history.empty')}
                    </div>
                    <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                      {historyMessage('history.emptyHint')}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {items.map((item) => {
                        const dateStr = new Date(item.completedAt).toLocaleString();
                        const isAccepted = item.outcomeType === 'OFFER_ACCEPTED';
                        const isSwap = item.outcomeType === 'FINAL_SWAP';
                        return (
                          <button type="button"
                            key={item.resultId}
                            onClick={() => loadDetail(item.resultId)}
                            style={{
                              padding: '14px 16px',
                              width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit',
                              borderRadius: '12px',
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              gap: '12px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{dateStr}</span>
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(139, 92, 246, 0.2)',
                                    color: '#c084fc',
                                  }}
                                >
                                  {aiName(item.aiType)}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: '#d1d5db' }}>
                                {historyMessage('history.originalBox', { box: item.originalPlayerBoxId })}
                                {isSwap && historyMessage('history.swappedBox', { box: item.finalPlayerBoxId })}
                                {' · '}
                                <span style={{ color: isAccepted ? '#facc15' : '#38bdf8' }}>
                                  {isAccepted ? historyMessage('history.outcomeAccepted') : isSwap ? historyMessage('history.outcomeSwap') : historyMessage('history.outcomeKeep')}
                                </span>
                              </div>
                            </div>

                            <div style={{ textAlign: 'right' }}>
                              <div
                                style={{
                                  fontSize: '1.25rem',
                                  fontWeight: 900,
                                  fontFamily: 'var(--font-mono)',
                                  color: '#fcd34d',
                                }}
                              >
                                {formatMoney(item.wonAmount)}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{historyMessage('history.clickDetails')}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Pagination */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '16px',
                        paddingTop: '12px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <button
                        type="button"
                        disabled={offset === 0}
                        onClick={() => loadList(Math.max(0, offset - PAGE_SIZE))}
                        style={{
                          minHeight: '44px',
                          padding: '6px 14px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: offset === 0 ? '#6b7280' : '#ffffff',
                          cursor: offset === 0 ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        <ChevronLeft size={16} /> {historyMessage('history.previous')}
                      </button>

                      <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                        {historyMessage('history.page', { current: currentPage, total: totalPages, count: total })}
                      </div>

                      <button
                        type="button"
                        disabled={offset + PAGE_SIZE >= total}
                        onClick={() => loadList(offset + PAGE_SIZE)}
                        style={{
                          minHeight: '44px',
                          padding: '6px 14px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: offset + PAGE_SIZE >= total ? '#6b7280' : '#ffffff',
                          cursor: offset + PAGE_SIZE >= total ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        {historyMessage('history.next')} <ChevronRight size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Detail View */
              <div>
                {detailLoading ? (
                  <div
                    style={{
                      padding: '40px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      color: '#9ca3af',
                    }}
                  >
                    <RefreshCw size={24} className="spin" />
                    <span>{historyMessage('history.loadingDetail')}</span>
                  </div>
                ) : detailError ? (
                  <div
                    style={{
                      padding: '24px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '12px',
                      textAlign: 'center',
                    }}
                  >
                    <AlertCircle size={24} color="#ef4444" style={{ margin: '0 auto 8px auto' }} />
                    <div style={{ color: '#fca5a5', fontSize: '0.9rem' }}>{detailError}</div>
                    <button
                      type="button"
                      onClick={() => selectedResultId && loadDetail(selectedResultId)}
                      style={{
                        marginTop: '12px',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        cursor: 'pointer',
                        minHeight: '44px',
                      }}
                    >
                      {historyMessage('history.refreshRetry')}
                    </button>
                  </div>
                ) : detailRecord ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Summary Hero Card */}
                    <div
                      style={{
                        padding: '16px 20px',
                        borderRadius: '16px',
                        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(139, 92, 246, 0.12) 100%)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '14px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.8rem', color: '#fcd34d', fontWeight: 700 }}>
                          {historyMessage('history.settlementScore')}
                        </div>
                        <div
                          style={{
                            fontSize: '2rem',
                            fontWeight: 900,
                            fontFamily: 'var(--font-mono)',
                            color: '#ffffff',
                            lineHeight: 1.1,
                            marginTop: '2px',
                          }}
                        >
                          {formatMoney(detailRecord.settlement.wonAmount)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '4px' }}>
                          {historyMessage('history.opponent', { name: aiName(detailRecord.aiType) })}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setIsFairnessOpen(true)}
                          style={{
                            minHeight: '44px',
                            padding: '8px 16px',
                            borderRadius: '10px',
                            border: '1px solid rgba(245, 158, 11, 0.5)',
                            background: 'rgba(245, 158, 11, 0.2)',
                            color: '#fcd34d',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <Shield size={16} />
                          <span>{historyMessage('history.fairness')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              targetType: 'match',
                              targetId: detailRecord.settlement.resultId,
                              targetDescription: `${historyMessage('history.resultId', { id: detailRecord.settlement.resultId.slice(0, 8) })} (${aiName(detailRecord.aiType)})`,
                            })
                          }
                          aria-label={historyMessage('history.reportAria')}
                          style={{
                            minHeight: '44px',
                            padding: '8px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#fca5a5',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <ShieldAlert size={16} />
                          <span>{historyMessage('history.report')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Box Comparison Cards */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{historyMessage('history.initialBox')}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                          #{detailRecord.settlement.originalPlayerBoxId}
                        </div>
                        {detailRecord.settlement.originalBoxAmount !== undefined && (
                          <div style={{ fontSize: '0.82rem', color: '#fcd34d', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                            {formatMoney(detailRecord.settlement.originalBoxAmount)}
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{historyMessage('history.finalBox')}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                          #{detailRecord.settlement.finalPlayerBoxId}
                        </div>
                        {detailRecord.settlement.finalBoxAmount !== undefined && (
                          <div style={{ fontSize: '0.82rem', color: '#67e8f9', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                            {formatMoney(detailRecord.settlement.finalBoxAmount)}
                          </div>
                        )}
                      </div>

                      {detailRecord.settlement.highestOfferAmount !== undefined && (
                        <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{historyMessage('history.highestOffer')}</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#facc15', fontFamily: 'var(--font-mono)' }}>
                            {formatMoney(detailRecord.settlement.highestOfferAmount)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Dual-Column Split on Desktop */}
                    <div className="history-detail-split">
                      {/* Left: Timeline & Decisions */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Offer & Decision Timeline */}
                        <div
                          style={{
                            background: 'rgba(0, 0, 0, 0.28)',
                            borderRadius: '14px',
                            padding: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                          }}
                        >
                          <div style={{ fontSize: '0.88rem', fontWeight: 800, marginBottom: '12px', color: '#e5e7eb' }}>
                            {historyMessage('history.timelineTitle')}
                          </div>
                          {detailRecord.offerHistory && detailRecord.offerHistory.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {detailRecord.offerHistory.map((offer) => (
                                <div
                                  key={offer.offerId}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    background:
                                      offer.outcome === 'ACCEPTED'
                                        ? 'rgba(16, 185, 129, 0.15)'
                                        : 'rgba(255, 255, 255, 0.04)',
                                    border:
                                      offer.outcome === 'ACCEPTED'
                                        ? '1px solid rgba(16, 185, 129, 0.4)'
                                        : '1px solid rgba(255, 255, 255, 0.06)',
                                    gap: '10px',
                                  }}
                                >
                                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    <div style={{ fontSize: '0.85rem', color: '#d1d5db' }}>
                                      {historyMessage('history.offerLog', { round: offer.round })}
                                    </div>
                                    {offer.dialogue && (
                                      <div style={{ maxWidth: '42rem', color: '#a78bfa', fontSize: '0.72rem', fontStyle: 'italic' }}>
                                        “{offer.dialogue}”
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                                    <span
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontWeight: 700,
                                        color: '#fcd34d',
                                      }}
                                    >
                                      {formatMoney(offer.amount)}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '0.75rem',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background:
                                          offer.outcome === 'ACCEPTED'
                                            ? '#10b981'
                                            : 'rgba(255, 255, 255, 0.1)',
                                        color: offer.outcome === 'ACCEPTED' ? '#000000' : '#9ca3af',
                                        fontWeight: 700,
                                      }}
                                    >
                                      {{ ACCEPTED: historyMessage('history.offerAccepted'), REJECTED: historyMessage('history.offerRejected'), EXPIRED: historyMessage('history.offerExpired'), PENDING: historyMessage('history.offerPending') }[offer.outcome]}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{historyMessage('history.noOffers')}</div>
                          )}
                        </div>

                        {/* Key Decisions Audit Trail */}
                        <section aria-label={historyMessage('history.timelineAria')} style={{ background: 'rgba(0, 0, 0, 0.22)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <h3 style={{ fontSize: '0.92rem', margin: '0 0 10px 0', color: '#e5e7eb' }}>{historyMessage('history.keyDecisions')}</h3>
                          <ol style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.8, fontSize: '0.84rem' }}>
                            {detailRecord.auditTrail.map(event => <li key={event.seq}>
                              {describeAuditEvent(event)}
                              <small style={{ color: '#9ca3af', marginLeft: 8 }}>{new Date(event.timestamp).toLocaleTimeString()}</small>
                            </li>)}
                          </ol>
                          {!detailRecord.auditTrail.length && <p style={{ color: '#9ca3af', margin: 0 }}>{historyMessage('history.oldTimeline')}</p>}
                        </section>
                      </div>

                      {/* Right: Replay & Share */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ background: 'rgba(0, 0, 0, 0.28)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 800, marginBottom: '10px', color: '#e5e7eb' }}>
                            {historyMessage('history.replayClassic')}
                          </div>
                          <button
                            type="button"
                            onClick={() => loadClassicReplay(detailRecord.settlement.resultId)}
                            disabled={classicReplayLoading}
                            style={{ ...historySecondaryButton, width: '100%', marginBottom: classicReplay ? '12px' : 0 }}
                          >
                            {classicReplayLoading ? historyMessage('history.replayLoading') : classicReplay ? historyMessage('history.replayReload') : historyMessage('history.replayView')}
                          </button>
                          {classicReplayError && <p role="alert" style={{ color: '#fca5a5', margin: '8px 0 0 0' }}>{classicReplayError}</p>}
                          {classicReplay && <ReplayViewer title={historyMessage('history.replayClassic')} events={classicReplay.events} />}
                        </div>

                        <div style={{ background: 'rgba(0, 0, 0, 0.28)', borderRadius: '14px', padding: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <ShareControls key={detailRecord.settlement.resultId} resultId={detailRecord.settlement.resultId} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          )}
        </div>
      </dialog>

      {/* Nested Fairness Verification Modal */}
      {detailRecord && (
        <FairnessModal
          isOpen={isFairnessOpen}
          onClose={() => setIsFairnessOpen(false)}
          record={detailRecord}
        />
      )}

      {/* Nested Report Modal */}
      {reportTarget && (
        <ReportDialog
          isOpen={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          targetType={reportTarget.targetType}
          targetId={reportTarget.targetId}
          targetDescription={reportTarget.targetDescription}
        />
      )}
    </>
  );
};
