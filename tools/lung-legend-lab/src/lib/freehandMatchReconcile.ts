/**
 * Freehand ↔ algorithm-hit reconciliation heuristics shared with the lab server.
 *
 * Compatible (near centroid + similar size) → keep match, drop freehand (success).
 * Incompatible → keep freehand GT, reject match.
 * Never keep both rows for the same code — see RL-FEEDBACK-STACK.md.
 */

/** Max distance (px) between match and freehand centroids for a “same place” hit. */
export const FREEHAND_MATCH_CENTROID_MAX_DIST = 40;

/** Match max-side / freehand bbox max-side must fall in this band. */
export const FREEHAND_MATCH_SIZE_RATIO_MIN = 0.4;
export const FREEHAND_MATCH_SIZE_RATIO_MAX = 2.5;

/**
 * How close a match must be to *contest* an outline. `multiple-adjacent-as-one`
 * codes have several instances (A1 owns both the mid-stem glyph and the lumen
 * band), so only hits competing for the outline's own locus are judged by it.
 */
export const FREEHAND_MATCH_CONTEST_DIST = 120;

/**
 * Summarize freehand vertices into centroid + axis-aligned extent.
 * @param points - Outline vertices
 */
export function summarizeFreehandPoints(
	points: Array<{ x: number; y: number }> | null | undefined,
): { cx: number; cy: number; w: number; h: number } | null {
	if (!points?.length) return null;
	let sx = 0;
	let sy = 0;
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const p of points) {
		sx += p.x;
		sy += p.y;
		x0 = Math.min(x0, p.x);
		y0 = Math.min(y0, p.y);
		x1 = Math.max(x1, p.x);
		y1 = Math.max(y1, p.y);
	}
	if (!Number.isFinite(x0)) return null;
	return {
		cx: sx / points.length,
		cy: sy / points.length,
		w: Math.max(1, x1 - x0),
		h: Math.max(1, y1 - y0),
	};
}

/**
 * Classify one match window against freehand geometry.
 * @param match - Algorithm hit center + window size
 * @param freehand - Freehand centroid + bbox extent
 */
export function classifyMatchVsFreehand(
	match: { cx: number; cy: number; w?: number | null; h?: number | null },
	freehand: { cx: number; cy: number; w: number; h: number },
): 'compatible' | 'incompatible' {
	const dist = Math.hypot(match.cx - freehand.cx, match.cy - freehand.cy);
	const matchSide = Math.max(match.w ?? 0, match.h ?? 0, 1);
	const fhSide = Math.max(freehand.w, freehand.h, 1);
	const sizeRatio = matchSide / fhSide;
	const near = dist <= FREEHAND_MATCH_CENTROID_MAX_DIST;
	const similarSize =
		sizeRatio >= FREEHAND_MATCH_SIZE_RATIO_MIN &&
		sizeRatio <= FREEHAND_MATCH_SIZE_RATIO_MAX;
	return near && similarSize ? 'compatible' : 'incompatible';
}

/**
 * Whether a match competes for the same locus as a freehand outline.
 *
 * Non-contesting hits are other instances of the same legend code and must stay
 * visible instead of being hidden as “incompatible with GT”.
 *
 * @param match - Algorithm hit center + window size
 * @param freehand - Freehand centroid + bbox extent
 */
export function matchContestsFreehand(
	match: { cx: number; cy: number; w?: number | null; h?: number | null },
	freehand: { cx: number; cy: number; w: number; h: number },
): boolean {
	if (Math.hypot(match.cx - freehand.cx, match.cy - freehand.cy) <= FREEHAND_MATCH_CONTEST_DIST) {
		return true;
	}
	const mw = (match.w ?? 0) / 2;
	const mh = (match.h ?? 0) / 2;
	return (
		Math.abs(match.cx - freehand.cx) <= mw + freehand.w / 2 &&
		Math.abs(match.cy - freehand.cy) <= mh + freehand.h / 2
	);
}
