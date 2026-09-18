import React, { useEffect, useState, useRef } from 'react';
import {
  Trophy,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Calendar,
  Medal,
  TrendingUp,
  Percent,
  Scale,
  DollarSign,
  Swords,
  Crown,
} from 'lucide-react';
import {
  fetchSeasons,
  fetchRankings,
  SeasonSummary,
  RankingEntry,
  type RankingBoard,
} from '../api/ranking';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import { formatMoney } from '../types/game';
import { translate, useLanguage, type TranslationKey } from '../i18n';
import './ModalsRevamp.css';

interface RankingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 10;

export const RankingModal: React.FC<RankingModalProps> = ({ isOpen, onClose }) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const requestRef = useRef(0);
  useModalLifecycle(dialogRef, isOpen);

  // Seasons state
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [selectedBoard, setSelectedBoard] = useState<RankingBoard>('elo');
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [seasonsError, setSeasonsError] = useState<string | null>(null);

  // Rankings state
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  // Load seasons once on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setSeasonsLoading(true);
    setSeasonsError(null);

    fetchSeasons()
      .then((res) => {
        if (!isMounted) return;
        if (res.ok && res.data) {
          setSeasons(res.data.items);
          const activeId = res.data.activeSeasonId || (res.data.items[0]?.seasonId ?? '');
          setSelectedSeasonId(activeId);
        } else {
          setSeasonsError(res.error?.message || msg('ranking.unavailable'));
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setSeasonsError(err?.message || msg('ranking.unavailable'));
      })
      .finally(() => {
        if (isMounted) setSeasonsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Load rankings whenever season or offset changes
  const loadRankings = (seasonId: string, currentOffset: number, board: RankingBoard = selectedBoard) => {
    const request = ++requestRef.current;
    setRankingsLoading(true);
    setRankingsError(null);

    fetchRankings({
      seasonId: seasonId || undefined,
      board,
      limit: PAGE_SIZE,
      offset: currentOffset,
    })
      .then((res) => {
        if (request !== requestRef.current) return;
        if (res.ok && res.data) {
          setRankings(res.data.items);
          setTotal(res.data.total);
          setOffset(res.data.offset);
        } else {
          setRankingsError(res.error?.message || msg('ranking.unavailable'));
        }
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        setRankingsError(err?.message || msg('ranking.unavailable'));
      })
      .finally(() => {
        if (request === requestRef.current) setRankingsLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    setOffset(0);
    loadRankings(selectedSeasonId, 0);
  }, [isOpen, selectedSeasonId, selectedBoard]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const currentSeason = seasons.find((s) => s.seasonId === selectedSeasonId);
  const boardLabels: Record<RankingBoard, string> = {
    elo: msg('ranking.board.elo'),
    net_profit: msg('ranking.board.netProfit'),
    challenger_profit: msg('ranking.board.challengerProfit'),
    banker_profit: msg('ranking.board.bankerProfit'),
    win_rate: msg('ranking.board.winRate'),
    survivor_wins: msg('ranking.board.survivorWins'),
    tournament_wins: msg('ranking.board.tournamentWins'),
    matches: msg('ranking.board.matches'),
    single_highest: msg('ranking.board.singleHighest'),
    single_margin: msg('ranking.board.singleMargin'),
  };
  const boardIcons: Record<RankingBoard, React.ReactNode> = {
    elo: <Trophy size={13} />,
    net_profit: <DollarSign size={13} />,
    challenger_profit: <Swords size={13} />,
    banker_profit: <TrendingUp size={13} />,
    win_rate: <Percent size={13} />,
    survivor_wins: <Medal size={13} />,
    tournament_wins: <Trophy size={13} />,
    matches: <Swords size={13} />,
    single_highest: <DollarSign size={13} />,
    single_margin: <Scale size={13} />,
  };
  const primaryMetricLabel = selectedBoard === 'single_highest' || selectedBoard === 'single_margin'
    ? boardLabels[selectedBoard]
    : msg('ranking.netProfit');
  const primaryMetricValue = (entry: RankingEntry) => selectedBoard === 'single_highest'
    ? entry.singleHighestProfit ?? 0
    : selectedBoard === 'single_margin'
      ? entry.singleBestDealMargin ?? 0
      : entry.netProfit;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="ranking-native-dialog"
      aria-labelledby="ranking-dialog-title"
    >
      <div className="ranking-dialog-content">
        {/* Header */}
        <div className="ranking-dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--gold-primary)',
              }}
            >
              <Trophy size={20} />
            </div>
            <div>
              <h2 id="ranking-dialog-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {msg('ranking.title')}
              </h2>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {msg('ranking.subtitle')}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={msg('ranking.close')}
            className="btn-settings-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Season & Board Selector Bar */}
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(0, 0, 0, 0.28)',
            border: '1px solid var(--border-glass)',
            borderRadius: '14px',
            marginBottom: '14px',
          }}
        >
          {/* Top row: Season & Period */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              paddingBottom: '10px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
              <Calendar size={16} style={{ color: 'var(--gold-light)' }} />
              <span style={{ fontWeight: 700 }}>{msg('ranking.currentSeason')}</span>
              {seasonsLoading ? (
                <span style={{ color: 'var(--text-secondary)' }}>{msg('ranking.loadingSeason')}</span>
              ) : seasons.length > 0 ? (
                <select
                  aria-label={msg('ranking.chooseSeason')}
                  value={selectedSeasonId}
                  onChange={(e) => setSelectedSeasonId(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid var(--border-glass)',
                    color: 'var(--text-primary)',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {seasons.map((s) => (
                    <option key={s.seasonId} value={s.seasonId} style={{ background: '#121626' }}>
                      {s.name} ({s.status === 'active' ? msg('ranking.seasonActive') : s.status === 'upcoming' ? msg('ranking.seasonUpcoming') : s.status === 'completed' ? msg('ranking.seasonCompleted') : msg('ranking.seasonArchived')})
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>{msg('ranking.defaultSeason')}</span>
              )}
            </div>

            {currentSeason && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {msg('ranking.period', {
                  start: new Date(currentSeason.startAt).toLocaleDateString(language),
                  end: new Date(currentSeason.endAt).toLocaleDateString(language),
                })}
              </div>
            )}
          </div>

          {/* Bottom row: Pill Tabs */}
          <div className="ranking-board-tabs-wrapper" role="tablist" aria-label={msg('ranking.chooseBoard')}>
            {(Object.keys(boardLabels) as RankingBoard[]).map((board) => {
              const isActive = selectedBoard === board;
              return (
                <button
                  key={board}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setSelectedBoard(board);
                    setOffset(0);
                  }}
                  className={`ranking-board-pill ${isActive ? 'active' : ''}`}
                >
                  {boardIcons[board]}
                  <span>{boardLabels[board]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Body */}
        <div className="ranking-table-container">
          {rankingsLoading ? (
            <div className="ranking-empty-state">
              <RefreshCw size={24} className="spin" style={{ color: 'var(--gold-light)' }} />
              <span>{msg('ranking.loading')}</span>
            </div>
          ) : rankingsError ? (
            <div className="ranking-error-banner">
              <AlertCircle size={24} color="#ef4444" style={{ margin: '0 auto 8px auto' }} />
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{msg('ranking.unavailable')}</div>
              <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>{rankingsError}</div>
              <button
                type="button"
                onClick={() => loadRankings(selectedSeasonId, offset)}
                style={{
                  marginTop: '12px',
                  padding: '6px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  minHeight: '38px',
                }}
              >
                {msg('ranking.retry')}
              </button>
            </div>
          ) : rankings.length === 0 ? (
            <div className="ranking-empty-state">
              <Medal size={36} style={{ color: 'var(--text-secondary)', marginBottom: '8px' }} />
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{msg('ranking.empty')}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {selectedBoard === 'elo' ? msg('ranking.emptyElo') : msg('ranking.emptyBoard', { board: boardLabels[selectedBoard] })}
              </div>
            </div>
          ) : (
              <div className="ranking-scroll-table-wrapper">
              <table className="ranking-table" aria-label={msg('ranking.tableAria')}>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: 'center', width: '60px' }}>{msg('ranking.rank')}</th>
                    <th scope="col">{msg('ranking.elo')}</th>
                    <th scope="col">{msg('ranking.winRate')}</th>
                    <th scope="col">{msg('ranking.roleBalance')}</th>
                    <th scope="col">{primaryMetricLabel}</th>
                    <th scope="col">{msg('ranking.roleProfit')}</th>
                    <th scope="col">{msg('ranking.matches')}</th>
                    <th scope="col">{msg('ranking.survivor')}</th>
                    <th scope="col">{msg('ranking.tournament')}</th>
                    <th scope="col">{msg('ranking.forfeitRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((entry) => {
                    const isTop1 = entry.rank === 1;
                    const isTop2 = entry.rank === 2;
                    const isTop3 = entry.rank === 3;
                    return (
                      <tr key={entry.rank} className={isTop1 ? 'row-top-1' : isTop2 ? 'row-top-2' : isTop3 ? 'row-top-3' : ''}>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`rank-badge ${
                              isTop1 ? 'rank-1' : isTop2 ? 'rank-2' : isTop3 ? 'rank-3' : 'rank-normal'
                            }`}
                          >
                            {isTop1 ? <Crown size={13} style={{ marginRight: '1px' }} /> : entry.rank}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--gold-light)' }}>
                            {entry.elo}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Percent size={13} style={{ color: '#38bdf8' }} />
                            <span>{(entry.winRate * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Scale size={13} style={{ color: '#c084fc' }} />
                            <span style={{ fontFamily: 'var(--font-mono)' }}>
                              {entry.roleBalanceReturnRate.toFixed(4)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              color: primaryMetricValue(entry) >= 0 ? '#34d399' : '#f87171',
                            }}
                          >
                            {formatMoney(primaryMetricValue(entry))}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#c4b5fd' }}>
                            {msg('ranking.challengerShort')} {formatMoney(entry.challengerProfit ?? 0)}<br />
                            {msg('ranking.bankerShort')} {formatMoney(entry.bankerProfit ?? 0)}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Swords size={13} style={{ color: '#9ca3af' }} />
                            <span>{entry.matchesPlayed} {msg('ranking.matchUnit')}</span>
                          </div>
                        </td>
                        <td>{entry.survivorWins ?? 0} / {entry.survivorGamesPlayed ?? 0}</td>
                        <td>{entry.tournamentWins ?? 0} / {entry.tournamentGamesPlayed ?? 0}</td>
                        <td>
                          <span style={{ color: entry.forfeitRate > 0.1 ? '#f87171' : 'var(--text-secondary)' }}>
                            {(entry.forfeitRate * 100).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer & Pagination */}
        <div className="ranking-dialog-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              disabled={offset === 0 || rankingsLoading}
              onClick={() => loadRankings(selectedSeasonId, Math.max(0, offset - PAGE_SIZE))}
              style={{
                minHeight: '38px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-glass)',
                color: offset === 0 ? '#6b7280' : 'var(--text-primary)',
                cursor: offset === 0 ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.85rem',
              }}
            >
              <ChevronLeft size={16} /> {msg('ranking.previous')}
            </button>

            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {msg('ranking.page', { current: currentPage, total: totalPages, count: total })}
            </span>

            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total || rankingsLoading}
              onClick={() => loadRankings(selectedSeasonId, offset + PAGE_SIZE)}
              style={{
                minHeight: '38px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-glass)',
                color: offset + PAGE_SIZE >= total ? '#6b7280' : 'var(--text-primary)',
                cursor: offset + PAGE_SIZE >= total ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.85rem',
              }}
            >
              {msg('ranking.next')} <ChevronRight size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-settings-done"
            style={{ minHeight: '38px', padding: '6px 20px' }}
          >
            {msg('ranking.done')}
          </button>
        </div>
      </div>
    </dialog>
  );
};
