import { getLanguage, translate, type TranslationKey } from '../i18n';

const ERROR_KEYS: Record<string, TranslationKey> = {
  INVALID_PHASE: 'error.invalidPhase',
  INVALID_BOX: 'error.invalidBox',
  INVALID_PAYLOAD: 'error.invalidPayload',
  OFFER_OUT_OF_RANGE: 'error.offerOutOfRange',
  OFFER_EXPIRED: 'error.offerExpired',
  RATE_LIMITED: 'error.rateLimited',
  STALE_VERSION: 'error.staleVersion',
  OUT_OF_SEQUENCE: 'error.outOfSequence',
  NOT_IN_MATCH: 'error.notInMatch',
  UNAUTHORIZED: 'error.unauthorized',
  ROOM_FULL: 'error.roomFull',
  DATABASE_UNAVAILABLE: 'error.databaseUnavailable',
};

/** Translate a server error code without exposing server internals. */
export function translateServerError(code?: string): string {
  const key = code ? ERROR_KEYS[code] : undefined;
  return key ? translate(key, getLanguage()) : translate('error.network', getLanguage());
}
