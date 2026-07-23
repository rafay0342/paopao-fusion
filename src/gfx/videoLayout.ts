export interface ContainVideoLayout {
  scale: number;
  x: number;
  y: number;
  renderedWidth: number;
  renderedHeight: number;
}

function requirePositiveDimension(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

/**
 * Returns one uniform scale that fits the complete source inside the viewport.
 * Using a single scalar preserves the source aspect ratio and cannot crop.
 */
export function containVideoScale(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  requirePositiveDimension('sourceWidth', sourceWidth);
  requirePositiveDimension('sourceHeight', sourceHeight);
  requirePositiveDimension('viewportWidth', viewportWidth);
  requirePositiveDimension('viewportHeight', viewportHeight);
  return Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
}

/** Produces a centered, aspect-ratio-safe contain layout in viewport units. */
export function containVideoLayout(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ContainVideoLayout {
  const scale = containVideoScale(sourceWidth, sourceHeight, viewportWidth, viewportHeight);
  return {
    scale,
    x: viewportWidth / 2,
    y: viewportHeight / 2,
    renderedWidth: sourceWidth * scale,
    renderedHeight: sourceHeight * scale,
  };
}
