const DEFAULT_MIN_TEXT_SCALE = 0.88;
const LOWEST_SUPPORTED_TEXT_SCALE = 0.5;

/**
 * Resolve a deterministic scale for one-line canvas text.
 *
 * `minScale` is the caller's readability floor, not a suggestion that can be
 * silently raised by the shared UI layer. This lets dense, explicitly designed
 * surfaces opt into a smaller floor while ordinary controls keep the default.
 */
export function resolveTextFitScale(
  textWidth: number,
  maxWidth: number,
  minScale = DEFAULT_MIN_TEXT_SCALE,
): number {
  const readableFloor = Number.isFinite(minScale)
    ? Math.min(1, Math.max(LOWEST_SUPPORTED_TEXT_SCALE, minScale))
    : DEFAULT_MIN_TEXT_SCALE;
  if (!Number.isFinite(textWidth) || textWidth <= 0) return 1;
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return readableFloor;
  return Math.max(readableFloor, Math.min(1, maxWidth / textWidth));
}
