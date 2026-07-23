export type OfflineShellStatus = 'idle' | 'unsupported' | 'insecure' | 'registering' | 'ready' | 'error';

export interface OfflineShellState {
  status: OfflineShellStatus;
  controlled: boolean;
  message: string;
}

export interface OfflineCapability {
  hasServiceWorker: boolean;
  isSecureContext: boolean;
  hostname: string;
}

export const OFFLINE_SHELL_EVENT = 'paopao:offline-shell-state';

let state: OfflineShellState = {
  status: 'idle',
  controlled: false,
  message: 'Offline shell has not started.',
};
let registrationStarted = false;

export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

export function canRegisterOfflineShell(capability: OfflineCapability): boolean {
  return capability.hasServiceWorker
    && (capability.isSecureContext || isLocalHostname(capability.hostname));
}

export function getOfflineShellState(): OfflineShellState {
  return { ...state };
}

function publish(next: OfflineShellState): void {
  state = next;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<OfflineShellState>(OFFLINE_SHELL_EVENT, { detail: getOfflineShellState() }));
  }
}

function monitorInstallation(registration: ServiceWorkerRegistration): void {
  const worker = registration.installing;
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant' && state.status !== 'ready') {
      publish({
        status: 'error',
        controlled: Boolean(navigator.serviceWorker.controller),
        message: 'Offline shell installation failed; online play is unchanged.',
      });
    }
  });
}

/**
 * Starts service-worker registration in the background. The immediate return
 * value is a snapshot; later status is available through getOfflineShellState
 * or the paopao:offline-shell-state window event.
 */
export function registerOfflineShell(): OfflineShellState {
  if (registrationStarted || typeof window === 'undefined' || typeof navigator === 'undefined') {
    return getOfflineShellState();
  }

  const capability: OfflineCapability = {
    hasServiceWorker: 'serviceWorker' in navigator,
    isSecureContext: window.isSecureContext,
    hostname: window.location.hostname,
  };

  if (!capability.isSecureContext && !isLocalHostname(capability.hostname)) {
    publish({ status: 'insecure', controlled: false, message: 'Offline play requires HTTPS or localhost.' });
    return getOfflineShellState();
  }

  if (!canRegisterOfflineShell(capability)) {
    publish({ status: 'unsupported', controlled: false, message: 'This browser does not support offline installation.' });
    return getOfflineShellState();
  }

  registrationStarted = true;
  publish({
    status: 'registering',
    controlled: Boolean(navigator.serviceWorker.controller),
    message: 'Preparing offline game files in the background.',
  });

  void navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).then((registration) => {
    monitorInstallation(registration);
    return navigator.serviceWorker.ready;
  }).then(() => {
    publish({
      status: 'ready',
      controlled: Boolean(navigator.serviceWorker.controller),
      message: 'Offline guest play is ready on this device.',
    });
  }).catch((error: unknown) => {
    publish({
      status: 'error',
      controlled: Boolean(navigator.serviceWorker.controller),
      message: error instanceof Error ? error.message : 'Offline shell registration failed.',
    });
  });

  return getOfflineShellState();
}
