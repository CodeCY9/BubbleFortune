import React, { useState, useEffect, useRef } from 'react';
import type {
  DuelHistorySummaryItem,
  DuelHistoryDetailResponse,
  DuelSeatId,
} from '../../../packages/protocol/src/duel';
import type { AuditEvent } from '../../../packages/protocol/src/types';
import { fetchGuestStatus } from '../../api/history';
import { fetchDuelHistoryList, fetchDuelHistoryDetail } from '../../api/duel';
import { formatMoney } from '../../types/game';
import { ShareControls } from '../ShareControls';
import { fetchReplay, type ReplaySummary } from '../../api/replay';
import { ReplayViewer } from '../ReplayViewer';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Download,
  Calendar,
  Award,
  Trophy,
  FileText,
} from 'lucide-react';
import { getLanguage, translate, useLanguage, type TranslationKey } from '../../i18n';

const PAGE_SIZE = 10;

const duelHistoryMessage = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
  Object.entries(replacements).reduce(
    (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
    translate(key, getLanguage()),
  );

function describeDuelAuditEvent(event: AuditEvent): string {
  const p = (event.payload || {}) as Record<string, unknown>;
  const roundPrefix =
    typeof p.roundIndex === 'number' && p.roundIndex > 0
      ? duelHistoryMessage('duel.history.audit.roundPrefix', { round: p.roundIndex })
      : '';

  switch (event.type) {
    case 'DUEL_STARTED':
    case 'MATCH_CREATED':
    case 'MATCH_STARTED':
      return duelHistoryMessage('duel.history.audit.started');
    case 'PLAYER_JOINED':
      return duelHistoryMessage('duel.history.audit.joined', { name: String(p.nickname ?? '') });
    case 'PLAYER_LEFT_LOBBY':
      return duelHistoryMessage('duel.history.audit.leftLobby');
    case 'PLAYER_RECONNECTED':
      return duelHistoryMessage('duel.history.audit.reconnected');
    case 'PLAYER_DISCONNECTED':
      return duelHistoryMessage('duel.history.audit.disconnected');
    case 'READY_TOGGLED':
      return p.ready ? duelHistoryMessage('duel.history.audit.ready') : duelHistoryMessage('duel.history.audit.unready');
    case 'ROUND_STARTED':
      return duelHistoryMessage('duel.history.audit.roundStarted', { prefix: roundPrefix });
    case 'SELECT_BOX':
    case 'BOX_SELECTED':
    case 'PLAYER_BOX_SELECTED':
      return duelHistoryMessage('duel.history.audit.selected', { prefix: roundPrefix, box: String(p.boxId ?? '') });
    case 'AUTO_SELECT_BOX':
      return duelHistoryMessage('duel.history.audit.autoSelected', { prefix: roundPrefix, box: String(p.boxId ?? '') });
    case 'OPEN_BOX':
    case 'BOX_OPENED': {
      const amtStr = typeof p.revealedAmount === 'number' ? `${formatMoney(p.revealedAmount)}` : '';
      return duelHistoryMessage('duel.history.audit.opened', { prefix: roundPrefix, box: String(p.boxId ?? ''), amount: amtStr ? duelHistoryMessage('duel.history.audit.revealedAmount', { amount: amtStr }) : '' });
    }
    case 'AUTO_OPEN_BOX': {
      const amtStr = typeof p.revealedAmount === 'number' ? `${formatMoney(p.revealedAmount)}` : '';
      return duelHistoryMessage('duel.history.audit.autoOpened', { prefix: roundPrefix, box: String(p.boxId ?? ''), amount: amtStr ? duelHistoryMessage('duel.history.audit.revealedAmount', { amount: amtStr }) : '' });
    }
    case 'SUBMIT_OFFER':
    case 'OFFER_SUBMITTED':
    case 'OFFER_MADE': {
      const amtStr = typeof p.amount === 'number' ? `${formatMoney(p.amount)}` : '';
      return duelHistoryMessage('duel.history.audit.offered', { prefix: roundPrefix, amount: amtStr });
    }
    case 'ACCEPT_OFFER':
    case 'OFFER_ACCEPTED': {
      const amtStr = typeof p.amount === 'number' ? `${formatMoney(p.amount)}` : '';
      return duelHistoryMessage('duel.history.audit.accepted', { prefix: roundPrefix, amount: amtStr });
    }
    case 'REJECT_OFFER':
    case 'OFFER_REJECTED':
      return duelHistoryMessage('duel.history.audit.rejected', { prefix: roundPrefix });
    case 'OFFER_SKIPPED_TIMEOUT':
      return duelHistoryMessage('duel.history.audit.skipped', { prefix: roundPrefix });
    case 'OFFER_REJECTED_TIMEOUT':
      return duelHistoryMessage('duel.history.audit.decisionTimeout', { prefix: roundPrefix });
    case 'KEEP_BOX':
    case 'FINAL_KEEP':
    case 'FINAL_CHOICE_KEEP':
      return duelHistoryMessage('duel.history.audit.kept', { prefix: roundPrefix });
    case 'SWAP_BOX':
    case 'FINAL_SWAP':
    case 'FINAL_CHOICE_SWAP':
      return duelHistoryMessage('duel.history.audit.swapped', { prefix: roundPrefix, box: String(p.targetBoxId ?? p.newBoxId ?? '') });
    case 'AUTO_FINAL_KEEP':
      return duelHistoryMessage('duel.history.audit.autoKept', { prefix: roundPrefix });
    case 'CONTINUE_ROUND_ACK':
      return duelHistoryMessage('duel.history.audit.continue', { prefix: roundPrefix });
    case 'ROUND_COMPLETE':
    case 'ROUND_COMPLETED':
    case 'ROUND_SETTLED':
      return duelHistoryMessage('duel.history.audit.completed', { prefix: roundPrefix });
    case 'FORFEIT':
    case 'LEAVE':
      return duelHistoryMessage('duel.history.audit.forfeit', { prefix: roundPrefix });
    case 'TIMEOUT_DISCONNECT':
      return duelHistoryMessage('duel.history.audit.timeoutForfeit', { prefix: roundPrefix });
    case 'MATCH_FINISHED':
    case 'GAME_SETTLED':
      return duelHistoryMessage('duel.history.audit.finished');
    default:
      return duelHistoryMessage('duel.history.audit.advanced', { prefix: roundPrefix, type: event.type });
  }
}

export const DuelHistoryPanel: React.FC = () => {
  useLanguage();
  const [view, setView] = useState<'LIST' | 'DETAIL'>('LIST');
  const [offset, setOffset] = useState(0);

  // List state
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<DuelHistorySummaryItem[]>([]);
  const [total, setTotal] = useState(0);

  // Detail state
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<DuelHistoryDetailResponse | null>(null);
  const [replay, setReplay] = useState<ReplaySummary | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const requestRef = useRef(0);

  const loadList = async (currentOffset = offset) => {
    const req = ++requestRef.current;
    setListLoading(true);
    setListError(null);

    const status = await fetchGuestStatus();
    if (req !== requestRef.current) return;

    if (!status.ok || !status.data?.enabled || !status.data.available) {
      setListError(
        status.ok && !status.data?.enabled
          ? duelHistoryMessage('history.dbDisabled')
          : status.error?.message || duelHistoryMessage('history.unavailable')
      );
      setListLoading(false);
      return;
    }

    if (!status.data.authenticated) {
      // Do not create guest session automatically on empty history viewing
      setItems([]);
      setTotal(0);
      setOffset(0);
      setListLoading(false);
      return;
    }

    fetchDuelHistoryList({ limit: PAGE_SIZE, offset: currentOffset })
      .then((res) => {
        if (req !== requestRef.current) return;
        if (res.ok && res.data) {
          setItems(res.data.items);
          setTotal(res.data.total);
          setOffset(res.data.offset);
        } else {
          setListError(res.error?.message || duelHistoryMessage('history.loadFailed'));
        }
      })
      .catch((err) => {
        if (req !== requestRef.current) return;
        setListError(err?.message || duelHistoryMessage('history.networkError'));
      })
      .finally(() => {
        if (req === requestRef.current) setListLoading(false);
      });
  };

  const loadDetail = (matchId: string) => {
    const req = ++requestRef.current;
    setDetailMatchId(matchId);
    setView('DETAIL');
    setDetailLoading(true);
    setDetailError(null);
    setDetailRecord(null);
    setReplay(null);

    fetchDuelHistoryDetail(matchId)
      .then((res) => {
        if (req !== requestRef.current) return;
        if (res.ok && res.data) {
          setDetailRecord(res.data);
        } else {
          setDetailError(res.error?.message || duelHistoryMessage('history.detailFailed'));
        }
      })
      .catch((err) => {
        if (req !== requestRef.current) return;
        setDetailError(err?.message || duelHistoryMessage('history.networkError'));
      })
      .finally(() => {
        if (req === requestRef.current) setDetailLoading(false);
      });
  };

  useEffect(() => {
    loadList(0);
    return () => {
      requestRef.current++;
    };
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const handleDownloadProof = (record: DuelHistoryDetailResponse) => {
    const proofData = {
      matchId: record.matchId,
      resultId: record.resultId,
      ruleVersion: record.ruleVersion,
      completedAt: record.completedAt,
      seats: record.seats,
      result: record.result,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(proofData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duel-proof-${record.matchId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 1. DETAIL VIEW
  if (view === 'DETAIL') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => {
              requestRef.current++;
              setView('LIST');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.85rem',
              padding: '4px 8px',
              borderRadius: '8px',
            }}
          >
            <ArrowLeft size={16} />
            <span>{duelHistoryMessage('duel.history.back')}</span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {detailLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px auto' }} />
              <div>{duelHistoryMessage('duel.history.detailLoading')}</div>
            </div>
          )}

          {detailError && (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ color: '#f87171', marginBottom: '12px' }}>{detailError}</div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => detailMatchId && loadDetail(detailMatchId)}
              >
                {duelHistoryMessage('history.retry')}
              </button>
            </div>
          )}

          {detailRecord && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Record Header */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: '16px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fcd34d' }}>
                      {duelHistoryMessage('duel.history.detailTitle', { matchId: detailRecord.matchId })}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                      {new Date(detailRecord.completedAt).toLocaleString()}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '0.85rem', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                        {detailRecord.result.reason === 'BOTH_FORFEIT'
                          ? duelHistoryMessage('duel.finished.bothForfeit')
                          : detailRecord.result.winnerSeatId === null
                          ? duelHistoryMessage('duel.finished.draw')
                          : `${duelHistoryMessage('duel.finished.win')}: ${detailRecord.seats.find((s) => s.seatId === detailRecord.result.winnerSeatId)?.nickname ?? duelHistoryMessage('duel.history.unknown')} (${detailRecord.result.winnerSeatId === detailRecord.mySeatId ? duelHistoryMessage('duel.finished.mine') : duelHistoryMessage('duel.finished.opponent')})`}
                      </span>
                      <span style={{ color: '#9ca3af' }}>
                        {duelHistoryMessage('duel.history.reasonLabel')}{' '}
                        {detailRecord.result.reason === 'FORFEIT'
                          ? (detailRecord.result.forfeitedSeatId === detailRecord.mySeatId ? duelHistoryMessage('duel.finished.forfeitSelf') : duelHistoryMessage('duel.finished.forfeitOpponent'))
                          : detailRecord.result.reason === 'TIMEOUT_DISCONNECT'
                          ? duelHistoryMessage('duel.finished.timeout')
                          : detailRecord.result.reason === 'BOTH_FORFEIT'
                          ? duelHistoryMessage('duel.finished.bothOffline')
                          : duelHistoryMessage('duel.finished.normal')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadProof(detailRecord)}
                    className="btn-secondary"
                    style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={14} />
                    <span>{duelHistoryMessage('duel.history.downloadProof')}</span>
                  </button>
                </div>

                {/* Seats Scores Comparison */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {detailRecord.seats.map((seat) => {
                    const isMe = seat.seatId === detailRecord.mySeatId;
                    const score = detailRecord.result.finalScores[seat.seatId] ?? 0;
                    const isWinner = detailRecord.result.winnerSeatId === seat.seatId;
                    return (
                      <div
                        key={seat.seatId}
                        style={{
                          background: isMe ? 'rgba(245, 158, 11, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                          border: isMe ? '1.5px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '12px',
                          padding: '12px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '0.85rem', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <span>{seat.nickname}</span>
                          {isMe && <span style={{ fontSize: '0.65rem', background: '#f59e0b', color: '#000', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>{duelHistoryMessage('duel.history.me')}</span>}
                          {isWinner && <Trophy size={14} color="#fcd34d" />}
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 900, color: score >= 0 ? '#34d399' : '#f87171', marginTop: '4px' }}>
                          {score >= 0 ? '+' : ''}{formatMoney(score)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <ShareControls resultId={detailRecord.resultId} mode="duel" />

              <button type="button" className="btn-secondary" disabled={replayLoading} onClick={() => { setReplayLoading(true); fetchReplay('duel', detailRecord.matchId).then((response) => { if (response.ok && response.data) setReplay(response.data); else setDetailError(response.error?.message || duelHistoryMessage('history.replayError')); }).finally(() => setReplayLoading(false)); }}>
                {replayLoading ? duelHistoryMessage('history.replayLoading') : duelHistoryMessage('history.replayView')}
              </button>
              {replay && <ReplayViewer title={duelHistoryMessage('duel.history.replayTitle')} events={replay.events} />}

              {/* Rounds Breakdown */}
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fcd34d', marginBottom: '8px' }}>
                  {duelHistoryMessage('duel.history.roundDetails')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[1, 2].map((rIdx) => {
                    const r = detailRecord.result.rounds.find((rd) => rd.roundIndex === rIdx);
                    if (!r) {
                      return (
                        <div
                          key={rIdx}
                          style={{
                            background: 'rgba(255, 255, 255, 0.02)',
                            borderRadius: '12px',
                            padding: '12px',
                            fontSize: '0.85rem',
                            color: '#6b7280',
                          }}
                        >
                          {duelHistoryMessage('duel.finished.incompleteRound', { round: rIdx })}
                        </div>
                      );
                    }

                    const isChallenger = detailRecord.mySeatId === r.challengerSeatId;
                    const myProfit = isChallenger ? r.challengerProfit : r.bankerProfit;
                    const opponentProfit = isChallenger ? r.bankerProfit : r.challengerProfit;
                    const outcomeLabel =
                      r.outcomeType === 'OFFER_ACCEPTED'
                        ? duelHistoryMessage('duel.finished.accepted', { amount: formatMoney(r.acceptedOfferAmount ?? 0) })
                        : r.outcomeType === 'FINAL_KEEP'
                        ? duelHistoryMessage('duel.finished.kept', { box: r.originalPlayerBoxId })
                        : r.outcomeType === 'FINAL_SWAP'
                        ? duelHistoryMessage('duel.finished.swapped', { box: r.finalPlayerBoxId })
                        : duelHistoryMessage('duel.finished.forfeited');

                    return (
                      <div
                        key={rIdx}
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '12px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
                          <strong style={{ color: '#f3f4f6' }}>
                            {duelHistoryMessage('duel.history.roundRole', { round: rIdx, role: isChallenger ? duelHistoryMessage('duel.finished.challenger') : duelHistoryMessage('duel.finished.banker') })}
                          </strong>
                          <span style={{ color: '#fbbf24' }}>
                            {outcomeLabel}
                          </span>
                        </div>

                        {/* Round details: highest offer, original & final boxes */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '6px',
                            background: 'rgba(0, 0, 0, 0.25)',
                            borderRadius: '8px',
                            padding: '8px 10px',
                            marginBottom: '8px',
                            fontSize: '0.75rem',
                            color: '#9ca3af',
                          }}
                        >
                          <div>
                            {duelHistoryMessage('duel.history.highestOffer')} <strong style={{ color: '#e5e7eb' }}>{formatMoney(r.highestOfferAmount)}</strong>
                          </div>
                          <div>
                            {duelHistoryMessage('duel.history.originalBox')} <strong style={{ color: '#e5e7eb' }}>#{r.originalPlayerBoxId} ({typeof r.originalPlayerBoxAmount === 'number' ? formatMoney(r.originalPlayerBoxAmount) : '-'})</strong>
                          </div>
                          <div>
                            {duelHistoryMessage('duel.history.finalBox')} <strong style={{ color: '#e5e7eb' }}>#{r.finalPlayerBoxId} ({typeof r.finalPlayerBoxAmount === 'number' ? formatMoney(r.finalPlayerBoxAmount) : '-'})</strong>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span>{duelHistoryMessage('duel.history.myProfit')} <strong style={{ color: myProfit >= 0 ? '#34d399' : '#f87171' }}>{myProfit >= 0 ? '+' : ''}{formatMoney(myProfit)}</strong></span>
                          <span>{duelHistoryMessage('duel.history.opponentProfit')} <strong style={{ color: opponentProfit >= 0 ? '#34d399' : '#f87171' }}>{opponentProfit >= 0 ? '+' : ''}{formatMoney(opponentProfit)}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Decision & Action Timeline */}
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fcd34d', marginBottom: '8px' }}>
                  {duelHistoryMessage('duel.history.timelineTitle')}
                </div>
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '12px',
                    padding: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    maxHeight: '200px',
                    overflowY: 'auto',
                  }}
                >
                  {detailRecord.result.auditTrail.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{duelHistoryMessage('duel.history.timelineEmpty')}</div>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {detailRecord.result.auditTrail.map((ev, i) => (
                        <li key={i} style={{ fontSize: '0.8rem', color: '#d1d5db', display: 'flex', gap: '8px' }}>
                          <span style={{ color: '#6b7280', flexShrink: 0 }}>
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                          <span>{describeDuelAuditEvent(ev)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. LIST VIEW
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {listLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px auto' }} />
            <div>{duelHistoryMessage('duel.history.loading')}</div>
          </div>
        )}

        {listError && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ color: '#f87171', marginBottom: '12px' }}>{listError}</div>
            <button type="button" className="btn-secondary" onClick={() => loadList(offset)}>
              {duelHistoryMessage('history.retry')}
            </button>
          </div>
        )}

        {!listLoading && !listError && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
            <Award size={36} color="#6b7280" style={{ margin: '0 auto 12px auto' }} />
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{duelHistoryMessage('duel.history.empty')}</div>
            <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              {duelHistoryMessage('duel.history.emptyHint')}
            </div>
          </div>
        )}

        {!listLoading && !listError && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map((item) => {
              const isWin = item.outcome === 'WIN';
              const isDraw = item.outcome === 'DRAW';
              const isVoid = item.outcome === 'VOID' || item.reason === 'BOTH_FORFEIT';

              let badgeBg = 'rgba(239, 68, 68, 0.2)';
              let badgeColor = '#f87171';
              let badgeText = duelHistoryMessage('duel.finished.lose');

              if (isVoid) {
                badgeBg = 'rgba(156, 163, 175, 0.2)';
                badgeColor = '#9ca3af';
                badgeText = duelHistoryMessage('duel.finished.bothForfeit');
              } else if (isWin) {
                badgeBg = 'rgba(16, 185, 129, 0.2)';
                badgeColor = '#34d399';
                badgeText = duelHistoryMessage('duel.finished.win');
              } else if (isDraw) {
                badgeBg = 'rgba(245, 158, 11, 0.2)';
                badgeColor = '#fbbf24';
                badgeText = duelHistoryMessage('duel.finished.draw');
              }

              return (
                <button
                  type="button"
                  key={item.resultId}
                  onClick={() => loadDetail(item.matchId)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '14px',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    width: '100%',
                    textAlign: 'left',
                    color: 'inherit',
                    font: 'inherit',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: badgeBg,
                          color: badgeColor,
                          fontWeight: 800,
                        }}
                      >
                        {badgeText}
                      </span>
                      <strong style={{ fontSize: '0.95rem', color: '#ffffff' }}>
                        {duelHistoryMessage('duel.history.vs', { name: item.opponentNickname })}
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      {new Date(item.completedAt).toLocaleDateString()} · {duelHistoryMessage('duel.history.matchLabel', { matchId: item.matchId })}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: item.myScore >= 0 ? '#34d399' : '#f87171' }}>
                      {item.myScore >= 0 ? '+' : ''}{formatMoney(item.myScore)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      {duelHistoryMessage('duel.history.opponentScore', { amount: formatMoney(item.opponentScore) })}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!listLoading && !listError && total > PAGE_SIZE && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => loadList(offset - PAGE_SIZE)}
            className="btn-secondary"
            style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.8rem' }}
          >
            <ChevronLeft size={16} />
            <span>{duelHistoryMessage('history.previous')}</span>
          </button>
          <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            {duelHistoryMessage('history.page', { current: currentPage, total: totalPages, count: total })}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => loadList(offset + PAGE_SIZE)}
            className="btn-secondary"
            style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.8rem' }}
          >
            <span>{duelHistoryMessage('history.next')}</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
