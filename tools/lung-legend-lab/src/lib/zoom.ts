/**
 * Cutaway zoom scale math shared by the Image View rail and the viewer.
 * Scale 1 = the whole 1024×953 frame fitted inside the viewport.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Button / rail increment — one press is a 10% nudge, not a jump. */
export const ZOOM_STEP = 0.1;

/** Wheel gain: factor = exp(-deltaY * WHEEL_GAIN). */
const WHEEL_GAIN = 0.0012;
/** Ceiling for a single wheel notch or pinch tick. */
const WHEEL_MAX_FACTOR = 1.05;

/**
 * Clamp a requested scale into the supported range at 0.1% granularity.
 * Sub-percent granularity keeps slow trackpad pinches from stalling.
 * @param zoom - Requested scale
 */
export function clampZoom(zoom: number): number {
	const rounded = Math.round(zoom * 1000) / 1000;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

/**
 * Multiplicative scale factor for one wheel / pinch event.
 * Proportional to deltaY so trackpad pinches stay continuous, capped so a
 * single mouse-wheel notch cannot throw the view across the frame.
 * @param deltaY - Native wheel deltaY (negative = zoom in)
 */
export function wheelZoomFactor(deltaY: number): number {
	const raw = Math.exp(-deltaY * WHEEL_GAIN);
	return Math.min(WHEEL_MAX_FACTOR, Math.max(1 / WHEEL_MAX_FACTOR, raw));
}
