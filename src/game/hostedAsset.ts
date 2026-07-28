interface HostedAssetWindow extends Window {
  __PAOPAO_ASSET_BASE__?: string;
}

const SAFE_REMOTE_PROTOCOLS = new Set(['http:', 'https:']);
const PASSTHROUGH_PROTOCOLS = new Set(['blob:', 'data:']);
const FALLBACK_DOCUMENT_BASE = 'https://paopao.invalid/';

function decodedAssetPath(value: string): string {
  try {
    const url = new URL(value.replace(/\\/g, '/'), FALLBACK_DOCUMENT_BASE);
    return decodeURIComponent(url.pathname).replace(/\\/g, '/');
  } catch {
    return value.replace(/\\/g, '/');
  }
}

/**
 * Fighting-mode media is retired from PaoPao Fusion. Keeping the check at the
 * shared URL boundary prevents a stale manifest or deployment config from
 * silently bringing those assets back into a public build.
 */
export function isBlockedAssetPath(path: string): boolean {
  return decodedAssetPath(path)
    .split('/')
    .some((segment) => segment.toLowerCase() === 'fight' || segment.toLowerCase() === 'fighting');
}

function browserDocumentBase(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof location !== 'undefined' && location.href) return location.href;
  return FALLBACK_DOCUMENT_BASE;
}

/**
 * Returns the single optional runtime asset root used by portable deployments.
 * A trailing slash is guaranteed so content-hashed manifest paths can be
 * resolved without string concatenation.
 */
export function assetBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const configured = (window as HostedAssetWindow).__PAOPAO_ASSET_BASE__?.trim();
  if (!configured) return null;

  let url: URL;
  try {
    url = new URL(configured, browserDocumentBase());
  } catch {
    throw new Error('PaoPao asset base is not a valid URL.');
  }
  if (!SAFE_REMOTE_PROTOCOLS.has(url.protocol)
    || url.username || url.password || url.search || url.hash
    || isBlockedAssetPath(url.href)) {
    throw new Error('PaoPao asset base is not a safe public HTTP URL.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

/**
 * Resolves legacy and content-hashed manifest paths through one deployment
 * boundary. Normal self-hosted paths stay byte-for-byte unchanged; AppDeploy
 * and other portable hosts can set `window.__PAOPAO_ASSET_BASE__` before the
 * game module is imported.
 */
export function hostedAssetUrl(path: string): string {
  if (isBlockedAssetPath(path)) {
    throw new Error('Retired fighting assets cannot be resolved by PaoPao Fusion.');
  }
  if (typeof window === 'undefined') return path;

  const configured = assetBaseUrl();
  if (!configured) return path;

  try {
    const absolute = new URL(path);
    if (SAFE_REMOTE_PROTOCOLS.has(absolute.protocol) || PASSTHROUGH_PROTOCOLS.has(absolute.protocol)) {
      return path;
    }
    throw new Error(`Unsupported asset URL protocol: ${absolute.protocol}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsupported asset URL protocol:')) throw error;
  }

  // Root-relative manifest values are intentionally relative to the configured
  // asset root (for example a content-addressed repository /public directory),
  // not to that remote origin's `/`.
  return new URL(path.replace(/^\/+/, ''), configured).href;
}
