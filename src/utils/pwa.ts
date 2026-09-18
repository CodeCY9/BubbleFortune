import { getLanguage, translate } from '../i18n';
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export interface PwaState { offline: boolean; canInstall: boolean; updateReady: boolean; message: string }
let state: PwaState = { offline: typeof navigator !== 'undefined' && !navigator.onLine, canInstall: false, updateReady: false, message: '' };
const listeners = new Set<() => void>();
let prompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | null = null;
let requestedUpdate = false;
let initialized = false;
const update = (patch: Partial<PwaState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const subscribePwa = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getPwaState = () => state;

export function initializePwa() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('online', () => update({ offline: false }));
  window.addEventListener('offline', () => update({ offline: true }));
  if (!import.meta.env.PROD) {
    // A previous production preview may have used the same local origin.
    // Release only this application's worker; never remove unrelated registrations.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration('/').then(reg => {
      if (reg && [reg.active, reg.waiting, reg.installing].some(worker => worker?.scriptURL === new URL('/sw.js', location.origin).href)) {
        return reg.unregister();
      }
    }).catch(() => {});
    return;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event as InstallPrompt; update({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => { prompt = null; update({ canInstall: false, message: translate('pwa.installed', getLanguage()) }); });
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (requestedUpdate) location.reload(); });
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
    registration = reg;
    const inspect = () => update({ updateReady: Boolean(reg.waiting) });
    inspect();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', inspect));
  }).catch(() => update({ message: translate('pwa.cacheError', getLanguage()) }));
}

export async function installPwa() {
  if (!prompt) return;
  const event = prompt; prompt = null; update({ canInstall: false });
  try { await event.prompt(); await event.userChoice; } catch { update({ message: translate('pwa.installError', getLanguage()) }); }
}
export function applyPwaUpdate(activeGame: boolean) {
  if (activeGame || !registration?.waiting) return;
  requestedUpdate = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}
