import { useEffect, useState } from 'react';
import type { PublicShareSummary } from '../packages/protocol/src/types';
import { fetchPublicShare, parseSharePath } from './api/share';
import type { MultiplayerShareSummary } from '../packages/protocol/src/share';
import { fetchPublicMultiplayerShare, parseMultiplayerSharePath } from './api/multiplayerShare';
import { fetchPublicAuctionShare, parseAuctionSharePath } from './api/auction';
import type { AuctionShareSummary } from '../packages/protocol/src/auction';
import { formatMoney } from './types/game';
import { translate, useLanguage } from './i18n';

export default function SharePage() {
  const language = useLanguage();
  const [data, setData] = useState<PublicShareSummary | null>(null);
  const [multiplayerData, setMultiplayerData] = useState<MultiplayerShareSummary | null>(null);
  const [auctionData, setAuctionData] = useState<AuctionShareSummary | null>(null);
  const [message, setMessage] = useState(() => translate('share.reading', language));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const multiplayerPath = parseMultiplayerSharePath(location.pathname);
    const auctionShareId = parseAuctionSharePath(location.pathname);
    if (auctionShareId) {
      setData(null);
      setMultiplayerData(null);
      setAuctionData(null);
      setMessage(translate('share.readingAuction', language));
      fetchPublicAuctionShare(auctionShareId).then(result => {
        if (cancelled) return;
        if (result.ok && result.data) { setAuctionData(result.data); setMessage(''); }
        else setMessage(result.error?.message || translate('share.readError', language));
      });
      return () => { cancelled = true; };
    }
    if (multiplayerPath) {
      setData(null);
      setMultiplayerData(null);
      setAuctionData(null);
      setMessage(translate('share.readingMultiplayer', language));
      fetchPublicMultiplayerShare(multiplayerPath.mode, multiplayerPath.shareId).then(result => {
        if (cancelled) return;
        if (result.ok && result.data) { setMultiplayerData(result.data); setMessage(''); }
        else setMessage(result.error?.message || translate('share.readError', language));
      });
      return () => { cancelled = true; };
    }
    setData(null);
    setMultiplayerData(null);
    setAuctionData(null);
    const id = parseSharePath(location.pathname);
    if (!id) { setMessage(translate('share.invalidLink', language)); return; }
    setMessage(translate('share.reading', language));
    fetchPublicShare(id).then(result => {
      if (cancelled) return;
      if (result.ok && result.data) { setData(result.data); setMessage(''); }
      else setMessage(result.error?.message || translate('share.readError', language));
    });
    return () => { cancelled = true; };
  }, [revision, language]);
  const modeLabel = auctionData
    ? translate('share.auctionMode', language)
    : multiplayerData
      ? translate('share.multiplayerMode', language)
      : translate('share.classicMode', language);
  const multiplayerModeLabel = multiplayerData
    ? ({ duel: translate('share.mode.duel', language), survivor: translate('share.mode.survivor', language), tournament: translate('share.mode.tournament', language) }[multiplayerData.mode] ?? multiplayerData.mode)
    : '';
  const outcomeLabel = data
    ? ({ OFFER_ACCEPTED: translate('share.accepted', language), FINAL_KEEP: translate('share.keep', language), FINAL_SWAP: translate('share.swap', language) }[data.outcomeType] ?? data.outcomeType)
    : '';
  return <main className="share-page"><article className="public-share-card">
    <img src="/icons/icon-192.png" width="72" height="72" alt="" />
    <p className="share-eyebrow">BubbleFortune · 26 {modeLabel}</p>
    <h1>{auctionData || multiplayerData ? translate('share.multiplayerTitle', language) : translate('share.classicTitle', language)}</h1>
    {auctionData ? <>
      <p>{translate('share.finalRanking', language)}</p><ol>{auctionData.rankings.map((entry) => <li key={`${entry.rank}-${entry.nickname}`}>{entry.nickname} · {formatMoney(entry.score)} · {translate('share.rank', language).replace('{rank}', String(entry.rank))}</li>)}</ol>
      <p className="share-note">{translate('share.publicAuctionNote', language)}</p>
    </> : multiplayerData ? <>
      <p>{translate('share.finalRanking', language)}</p>
      <ol>{multiplayerData.rankings.map((entry) => <li key={`${entry.rank}-${entry.nickname}`}>{entry.nickname} · {formatMoney(entry.score)} · {translate('share.rank', language).replace('{rank}', String(entry.rank))}</li>)}</ol>
      <dl><dt>{translate('share.mode', language)}</dt><dd>{multiplayerModeLabel}</dd><dt>{translate('share.result', language)}</dt><dd>{multiplayerData.winnerNickname ? translate('share.winner', language).replace('{name}', multiplayerData.winnerNickname) : translate('share.draw', language)}</dd></dl>
      <p className="share-note">{translate('share.publicMultiplayerNote', language)}</p>
    </> : data ? <>
      <p>{translate('share.earned', language)}</p><strong className="share-amount">{formatMoney(data.wonAmount)}</strong>
      <dl><dt>{translate('share.outcome', language)}</dt><dd>{outcomeLabel}</dd>
        <dt>{translate('share.opponent', language)}</dt><dd>{{ conservative: translate('share.ai.conservative', language), aggressive: translate('share.ai.aggressive', language), cold: translate('share.ai.cold', language), inducement: translate('share.ai.inducement', language), crazy: translate('share.ai.crazy', language) }[data.aiType]}</dd>
        <dt>{translate('share.playerBox', language)}</dt><dd>{data.originalPlayerBoxId} → {data.finalPlayerBoxId}</dd></dl>
      <p className="share-note">{translate('share.publicClassicNote', language)}</p>
    </> : <><p role="status">{message}</p><button className="btn-secondary" onClick={() => setRevision(value => value + 1)}>{translate('share.retry', language)}</button></>}
    <a className="btn-primary" href="/">{translate('share.enter', language)}</a>
    <nav aria-label={translate('common.legalNav', language)} style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 14, fontSize: '.8rem' }}>
      <a href="/privacy">{translate('common.privacy', language)}</a><a href="/terms">{translate('common.terms', language)}</a>
    </nav>
  </article></main>;
}
