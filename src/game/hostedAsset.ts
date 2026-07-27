interface HostedAssetWindow extends Window {
  __PAOPAO_ASSET_BASE__?: string;
}

/**
 * Keeps the normal self-hosted paths unchanged while allowing an explicitly
 * configured public asset origin for portable frontend-only deployments.
 */
export function hostedAssetUrl(path: string): string {
  if (typeof window === 'undefined' || !path.startsWith('/')) return path;
  const configured = (window as HostedAssetWindow).__PAOPAO_ASSET_BASE__?.trim().replace(/\/+$/, '');
  return configured ? `${configured}${path}` : path;
}
