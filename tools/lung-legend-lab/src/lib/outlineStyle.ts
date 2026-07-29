/**
 * Shared silhouette-outline visual language for algorithm hits and freehand GT.
 * Must stay aligned with `scripts/lung_template_match.py`:
 *   OUTLINE_STROKE_PX = 22
 *   OUTLINE_COLOR_BGR = (10, 214, 255)  → RGB #ffd60a
 *
 * OpenCV builds a hollow ring via dilate(radius = stroke//2) − mask, so the
 * **visible** yellow band is ~11px, not 22. SVG `strokeWidth` is the full
 * centered band — use OUTLINE_RING_PX for freehand polys or they look ~2–3× fat.
 */

/** OpenCV dilate parameter for `{slug}-outline.png` (not SVG stroke width). */
export const OUTLINE_STROKE_PX = 22;

/**
 * Visible ring thickness in native cutaway px (OpenCV dilate radius).
 * Use this for SVG freehand / preview strokes.
 */
export const OUTLINE_RING_PX = Math.max(1, Math.floor(OUTLINE_STROKE_PX / 2));

/** Yellow outline colour matching OpenCV `OUTLINE_COLOR_BGR` (sRGB hex). */
export const OUTLINE_COLOR_HEX = '#ffd60a';

/** Soft fill under freehand / flash polys (same hue family). */
export const OUTLINE_FILL_RGBA = 'rgba(255, 214, 10, 0.14)';
