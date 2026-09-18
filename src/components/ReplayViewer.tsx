import React, { useEffect, useMemo, useState } from 'react';
import { translate, useLanguage } from '../i18n';

export interface ReplayEventLike {
  seq?: number;
  type?: string;
  timestamp?: number;
}

interface ReplayViewerProps {
  events: ReplayEventLike[];
  title?: string;
  describe?: (event: ReplayEventLike, index: number) => string;
}

const buttonStyle: React.CSSProperties = {
  minHeight: '40px',
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,.16)',
  background: 'rgba(255,255,255,.06)',
  color: '#fff',
  cursor: 'pointer',
};

/** A small, dependency-free timeline player for server-authoritative replay events. */
export const ReplayViewer: React.FC<ReplayViewerProps> = ({ events, title, describe }) => {
  const language = useLanguage();
  const msg = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const resolvedTitle = title || msg('replay.defaultTitle');
  const [index, setIndex] = useState(events.length ? 0 : -1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setIndex(events.length ? 0 : -1);
    setPlaying(false);
  }, [events]);

  useEffect(() => {
    if (!playing || index >= events.length - 1) {
      if (playing && index >= events.length - 1) setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((current) => Math.min(events.length - 1, current + 1)), 800);
    return () => window.clearTimeout(timer);
  }, [playing, index, events.length]);

  const visibleEvents = useMemo(() => events.slice(0, Math.max(0, index + 1)), [events, index]);
  const current = index >= 0 ? events[index] : null;

  return (
    <section aria-label={resolvedTitle} style={{ marginTop: '14px', padding: '14px', borderRadius: '12px', background: 'rgba(15,23,42,.6)', border: '1px solid rgba(255,255,255,.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <strong>{resolvedTitle} · {msg('replay.events', { count: events.length })}</strong>
        <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>{index >= 0 ? msg('replay.position', { current: index + 1, total: events.length }) : msg('replay.none')}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        <button type="button" style={buttonStyle} onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index <= 0}>{msg('replay.previous')}</button>
        <button type="button" style={buttonStyle} onClick={() => setPlaying((value) => !value)} disabled={!events.length || index >= events.length - 1}>{playing ? msg('replay.pause') : msg('replay.play')}</button>
        <button type="button" style={buttonStyle} onClick={() => setIndex((value) => Math.min(events.length - 1, value + 1))} disabled={index >= events.length - 1}>{msg('replay.next')}</button>
        <input aria-label={msg('replay.progress')} type="range" min={events.length ? 0 : -1} max={Math.max(0, events.length - 1)} value={Math.max(0, index)} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} style={{ flex: '1 1 180px', minWidth: '150px' }} disabled={!events.length} />
      </div>
      {current && <div style={{ marginTop: '10px', color: '#fcd34d', fontSize: '.85rem' }}>{msg('replay.current')}{describe ? describe(current, index) : current.type || msg('replay.event')}</div>}
      <ol style={{ margin: '10px 0 0', paddingLeft: '22px', maxHeight: '180px', overflowY: 'auto', lineHeight: 1.7 }}>
        {visibleEvents.slice(-24).map((event, visibleIndex) => {
          const absoluteIndex = Math.max(0, index - Math.min(24, visibleEvents.length) + 1) + visibleIndex;
          return <li key={`${event.seq ?? absoluteIndex}-${event.type ?? 'event'}-${absoluteIndex}`} style={{ color: absoluteIndex === index ? '#fff' : '#94a3b8' }}>{describe ? describe(event, absoluteIndex) : `#${event.seq ?? absoluteIndex + 1} · ${event.type || msg('replay.event')}`}</li>;
        })}
      </ol>
    </section>
  );
};
