import type { AuditEvent } from '../../packages/protocol/src/types';
import { formatMoney } from '../types/game';

export function describeAuditEvent(event: AuditEvent): string {
  const p = event.payload;
  const source = p.source === 'timeout' ? '（超时自动处理）' : '';
  const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? formatMoney(value) : '未提供';
  switch (event.type) {
    case 'GAME_CREATED': return '对局开始';
    case 'PLAYER_BOX_SELECTED':
    case 'BOX_SELECTED': return `选择 ${p.boxId} 号个人箱${source}`;
    case 'BOX_OPENED': return `打开 ${p.boxId} 号箱，金额 ${amount(p.revealedAmount)}${source}`;
    case 'OFFER_MADE': return `第 ${p.round} 轮报价 ${amount(p.amount)}`;
    case 'OFFER_ACCEPTED': return `接受报价 ${amount(p.amount)}${source}`;
    case 'OFFER_REJECTED': return `拒绝本轮报价${source}`;
    case 'FINAL_KEEP': return `最终保留 ${p.boxId} 号箱${source}`;
    case 'FINAL_SWAP': return `将 ${p.originalBoxId} 号箱交换为 ${p.newBoxId} 号箱${source}`;
    case 'GAME_SETTLED': return `对局结束，获得 ${amount(p.wonAmount)}`;
    default: return '对局状态更新';
  }
}
