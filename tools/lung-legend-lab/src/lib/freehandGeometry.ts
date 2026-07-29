/**
 * Freehand outline cleanup: auto-close near gaps, remove dangling “string”
 * segments via stroke rasterization + largest-contour extraction (same family
 * of approach as OpenCV findContours on a painted stroke), then optional
 * Chaikin smooth + high-contrast edge hug for flat biomedical atlas art.
 *
 * Contour cleanup is pure JS (no DOM). Edge snap uses an optional ImageData
 * / cutaway URL and is browser-only — never a template-match detector.
 */
import type { TracePoint } from '../types';

/** Snap-close when start/end are within this many native cutaway pixels. */
export const AUTO_CLOSE_PX = 32;

/**
 * Fallback cutaway size used only if a loaded `<img>` fails to report a
 * natural width/height. Every function below that takes both `points` and a
 * cutaway image loads that image from the *same* asset URL the points were
 * captured against, so the two always already share one pixel space —
 * no separate canonical→native scale factor is needed here (that
 * anisotropic-scale problem is solved once, upstream, in
 * `scripts/lung_template_match.py`'s `canonical_scale_factors`).
 */
export const CUTAWAY_W = 1024;
export const CUTAWAY_H = 953;

/** Search radius (px) when hugging high-contrast illustration outlines. */
export const EDGE_SNAP_RADIUS = 10;

/** Max displacement per vertex when snapping toward an edge (per pass). */
export const EDGE_SNAP_MAX_STEP = 6;

/** Number of snake-style inward/outward attraction passes. */
export const EDGE_SNAP_PASSES = 3;

/** Minimum Sobel magnitude to accept a snap target (atlas ink). */
export const EDGE_SNAP_MIN_GRAD = 28;

/**
 * Gaps larger than this need a zoomed manual-close editor
 * (not obvious enough to snap blindly).
 */
export const MANUAL_CLOSE_MIN_PX = 32;

/** Beyond this, reject / force manual close editor. */
export const MANUAL_CLOSE_MAX_PX = 120;

export type FreehandCleanResult = {
	points: TracePoint[];
	/** Euclidean gap before closing. */
	gap: number;
	/** True when we snapped start/end automatically. */
	autoClosed: boolean;
	/** True when the owner must finish the close in a zoomed editor. */
	needsManualClose: boolean;
	/** True when contour extraction removed dangling spur geometry. */
	cleaned: boolean;
	pointCountBefore: number;
	pointCountAfter: number;
};

/**
 * Distance between two points.
 * @param a - First point
 * @param b - Second point
 */
export function dist(a: TracePoint, b: TracePoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Gap between first and last vertex (0 if already closed / empty).
 * @param points - Polyline
 */
export function closureGap(points: TracePoint[]): number {
	if (points.length < 2) return Infinity;
	return dist(points[0], points[points.length - 1]);
}

/**
 * Append first point to close a ring when not already closed.
 * @param points - Polyline
 */
export function ensureClosed(points: TracePoint[]): TracePoint[] {
	if (points.length < 3) return points;
	const first = points[0];
	const last = points[points.length - 1];
	if (dist(first, last) < 1.0) {
		return [...points.slice(0, -1), { x: first.x, y: first.y }];
	}
	return [...points, { x: first.x, y: first.y }];
}

/**
 * Bounding box with padding for rasterization.
 * @param points - Polyline
 * @param pad - Padding in px
 */
function boundsOf(points: TracePoint[], pad: number) {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x0 = Math.floor(Math.min(...xs) - pad);
	const y0 = Math.floor(Math.min(...ys) - pad);
	const x1 = Math.ceil(Math.max(...xs) + pad);
	const y1 = Math.ceil(Math.max(...ys) + pad);
	return { x0, y0, x1, y1, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
}

/**
 * Stamp a filled disk onto a binary mask (for thick stroke painting).
 * @param mask - Row-major 0/1 mask (mutated)
 * @param w - Width
 * @param h - Height
 * @param cx - Center x
 * @param cy - Center y
 * @param r - Radius
 */
function stampDisk(
	mask: Uint8Array,
	w: number,
	h: number,
	cx: number,
	cy: number,
	r: number,
) {
	const r2 = r * r;
	const x0 = Math.max(0, Math.floor(cx - r));
	const y0 = Math.max(0, Math.floor(cy - r));
	const x1 = Math.min(w - 1, Math.ceil(cx + r));
	const y1 = Math.min(h - 1, Math.ceil(cy + r));
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const dx = x - cx;
			const dy = y - cy;
			if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
		}
	}
}

/**
 * Paint a thick polyline stroke onto a binary mask.
 * @param mask - Row-major mask
 * @param w - Width
 * @param h - Height
 * @param points - Polyline in mask-local coords
 * @param radius - Half stroke width
 */
function paintStroke(
	mask: Uint8Array,
	w: number,
	h: number,
	points: TracePoint[],
	radius: number,
) {
	if (points.length === 0) return;
	stampDisk(mask, w, h, points[0].x, points[0].y, radius);
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const steps = Math.max(1, Math.ceil(dist(a, b)));
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			stampDisk(mask, w, h, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius);
		}
	}
}

/**
 * Even-odd fill of a closed polygon into a binary mask.
 * @param mask - Row-major mask (mutated; ORs with existing)
 * @param w - Width
 * @param h - Height
 * @param points - Closed polygon in mask-local coords
 */
function fillPolygonEvenOdd(
	mask: Uint8Array,
	w: number,
	h: number,
	points: TracePoint[],
) {
	if (points.length < 3) return;
	const ys = points.map((p) => p.y);
	const yMin = Math.max(0, Math.floor(Math.min(...ys)));
	const yMax = Math.min(h - 1, Math.ceil(Math.max(...ys)));
	for (let y = yMin; y <= yMax; y++) {
		const crossings: number[] = [];
		for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
			const pi = points[i];
			const pj = points[j];
			const yi = pi.y;
			const yj = pj.y;
			if ((yi > y) === (yj > y)) continue;
			const x = pj.x + ((pi.x - pj.x) * (y - yj)) / (yi - yj || 1e-9);
			crossings.push(x);
		}
		crossings.sort((a, b) => a - b);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			const x0 = Math.max(0, Math.ceil(crossings[k]));
			const x1 = Math.min(w - 1, Math.floor(crossings[k + 1]));
			for (let x = x0; x <= x1; x++) mask[y * w + x] = 1;
		}
	}
}

/**
 * Extract the outer contour of a binary mask using a Moore-neighborhood walk.
 * Removes interior holes and dangling 1-px filaments that are not on the outer ring.
 *
 * @param mask - Row-major 0/1 mask
 * @param w - Width
 * @param h - Height
 */
function mooreContour(mask: Uint8Array, w: number, h: number): Array<{ x: number; y: number }> {
	const at = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0;

	let sx = -1;
	let sy = -1;
	outer: for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (at(x, y) && !at(x, y - 1)) {
				sx = x;
				sy = y;
				break outer;
			}
		}
	}
	if (sx < 0) return [];

	// N, NE, E, SE, S, SW, W, NW
	const dx = [0, 1, 1, 1, 0, -1, -1, -1];
	const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

	const contour: Array<{ x: number; y: number }> = [];
	let x = sx;
	let y = sy;
	let dir = 4; // came from west → start looking south-ish
	const maxSteps = w * h * 4;

	for (let step = 0; step < maxSteps; step++) {
		contour.push({ x, y });
		let found = false;
		for (let k = 0; k < 8; k++) {
			const nd = (dir + 6 + k) % 8; // turn left-first
			const nx = x + dx[nd];
			const ny = y + dy[nd];
			if (at(nx, ny)) {
				x = nx;
				y = ny;
				dir = nd;
				found = true;
				break;
			}
		}
		if (!found) break;
		if (x === sx && y === sy && contour.length > 3) break;
	}

	return contour;
}

/**
 * Decimate a dense contour to ~maxPoints while preserving shape (uniform stride + endpoints).
 * @param pts - Dense contour
 * @param maxPoints - Target vertex budget
 */
function decimate(pts: TracePoint[], maxPoints: number): TracePoint[] {
	if (pts.length <= maxPoints) return pts;
	const out: TracePoint[] = [];
	const step = (pts.length - 1) / (maxPoints - 1);
	for (let i = 0; i < maxPoints - 1; i++) {
		const idx = Math.round(i * step);
		out.push(pts[idx]);
	}
	out.push(pts[0]);
	return ensureClosed(out);
}

/**
 * Morphological dilate (square neighborhood) into a new buffer.
 * @param mask - Source mask
 * @param w - Width
 * @param h - Height
 * @param r - Radius
 */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
	const out = new Uint8Array(mask.length);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let on = 0;
			for (let dy = -r; dy <= r && !on; dy++) {
				for (let dx = -r; dx <= r; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) {
						on = 1;
						break;
					}
				}
			}
			out[y * w + x] = on;
		}
	}
	return out;
}

/**
 * Morphological erode (square neighborhood) into a new buffer.
 * @param mask - Source mask
 * @param w - Width
 * @param h - Height
 * @param r - Radius
 */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
	const out = new Uint8Array(mask.length);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let on = 1;
			for (let dy = -r; dy <= r && on; dy++) {
				for (let dx = -r; dx <= r; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) {
						on = 0;
						break;
					}
				}
			}
			out[y * w + x] = on;
		}
	}
	return out;
}

/**
 * Morphological close (dilate then erode) on a binary mask — seals hairline gaps.
 * @param mask - Mutated in place
 * @param w - Width
 * @param h - Height
 * @param r - Radius in px
 */
function morphClose(mask: Uint8Array, w: number, h: number, r: number) {
	const closed = erode(dilate(mask, w, h, r), w, h, r);
	mask.set(closed);
}

/**
 * Morphological open (erode then dilate) — shaves thin spur / string protrusions.
 * @param mask - Mutated in place
 * @param w - Width
 * @param h - Height
 * @param r - Radius in px
 */
function morphOpen(mask: Uint8Array, w: number, h: number, r: number) {
	const opened = dilate(erode(mask, w, h, r), w, h, r);
	mask.set(opened);
}

/**
 * Rasterize the freehand stroke, fill the enclosed region when closed enough,
 * open to drop dangling “string” tails, and return the largest outer contour
 * (contour-of-stroke / findContours-style approach).
 *
 * @param points - Raw freehand polyline in native cutaway coords
 * @param strokeWidth - Paint width for the stroke before contouring
 */
export function extractOuterContour(
	points: TracePoint[],
	strokeWidth = 5,
): TracePoint[] | null {
	if (points.length < 3) return null;

	const radius = Math.max(1, strokeWidth / 2);
	const pad = Math.ceil(strokeWidth * 2 + 6);
	const b = boundsOf(points, pad);
	const local = points.map((p) => ({ x: p.x - b.x0, y: p.y - b.y0 }));
	const mask = new Uint8Array(b.w * b.h);

	const gap = closureGap(points);
	const closedLocal = ensureClosed(local);

	// Prefer filled interior of the closed loop (drops interior/exterior strings
	// that are not part of the main enclosed area after morph-open).
	if (gap <= AUTO_CLOSE_PX || dist(local[0], local[local.length - 1]) < 1) {
		fillPolygonEvenOdd(mask, b.w, b.h, closedLocal);
	}
	// Seal with a thick stroke so nearly-closed bowls still form a region.
	paintStroke(mask, b.w, b.h, closedLocal, radius);

	morphClose(mask, b.w, b.h, 1);
	// Kill thin spur corridors (stroke-width strings inside/outside the loop).
	morphOpen(mask, b.w, b.h, Math.max(1, Math.floor(radius)));
	morphClose(mask, b.w, b.h, 1);

	const contour = mooreContour(mask, b.w, b.h);
	if (contour.length < 8) return null;

	const world = contour.map((p) => ({
		x: Math.round((p.x + b.x0) * 10) / 10,
		y: Math.round((p.y + b.y0) * 10) / 10,
	}));
	return decimate(ensureClosed(world), 280);
}

/**
 * Clean a freehand stroke into a closed expert outline.
 * Auto-closes small gaps; flags larger gaps for the zoomed manual-close UI;
 * extracts the outer contour to remove dangling string segments.
 *
 * @param raw - Raw pointer samples from the viewer
 */
export function cleanFreehandOutline(raw: TracePoint[]): FreehandCleanResult {
	const pointCountBefore = raw.length;
	if (raw.length < 3) {
		return {
			points: raw,
			gap: Infinity,
			autoClosed: false,
			needsManualClose: true,
			cleaned: false,
			pointCountBefore,
			pointCountAfter: raw.length,
		};
	}

	const gap = closureGap(raw);

	if (gap > AUTO_CLOSE_PX) {
		// Ambiguous or too large — owner must finish the close in the zoom editor.
		return {
			points: raw,
			gap,
			autoClosed: false,
			needsManualClose: true,
			cleaned: false,
			pointCountBefore,
			pointCountAfter: raw.length,
		};
	}

	const snapped = ensureClosed(raw);
	const contour = extractOuterContour(snapped, 5);
	if (contour && contour.length >= 8) {
		const smoothed = atlasSmoothClosedOutline(contour);
		return {
			points: smoothed,
			gap,
			autoClosed: gap > 1,
			needsManualClose: false,
			cleaned: true,
			pointCountBefore,
			pointCountAfter: smoothed.length,
		};
	}

	// Fallback: snap close + atlas geometric smooth without contour extraction.
	const fallback = atlasSmoothClosedOutline(snapped);
	return {
		points: fallback,
		gap,
		autoClosed: gap > 1,
		needsManualClose: false,
		cleaned: false,
		pointCountBefore,
		pointCountAfter: fallback.length,
	};
}

/**
 * Apply a manual closing polyline (from the zoom editor) then clean.
 * @param openStroke - Original open freehand
 * @param bridge - Points drawn to bridge the gap (native coords)
 */
export function applyManualClose(
	openStroke: TracePoint[],
	bridge: TracePoint[],
): FreehandCleanResult {
	const merged = [...openStroke];
	for (const p of bridge) {
		const tail = merged[merged.length - 1];
		if (!tail || dist(tail, p) > 0.5) merged.push(p);
	}
	const closed = ensureClosed(merged);
	// After a manual bridge, force contour clean even if residual gap was tiny.
	const gap = closureGap(merged);
	const contour = extractOuterContour(closed, 5);
	if (contour && contour.length >= 8) {
		const smoothed = atlasSmoothClosedOutline(contour);
		return {
			points: smoothed,
			gap,
			autoClosed: false,
			needsManualClose: false,
			cleaned: true,
			pointCountBefore: openStroke.length,
			pointCountAfter: smoothed.length,
		};
	}
	return cleanFreehandOutline(closed);
}

/**
 * One Chaikin corner-cutting pass on a closed ring (excludes duplicate close vertex).
 * Softens jagged pointer samples while preserving overall shape.
 * @param points - Closed or open polyline
 */
function chaikinPass(points: TracePoint[]): TracePoint[] {
	if (points.length < 4) return points;
	const ring =
		dist(points[0], points[points.length - 1]) < 1.5
			? points.slice(0, -1)
			: points;
	if (ring.length < 3) return points;
	const out: TracePoint[] = [];
	const n = ring.length;
	for (let i = 0; i < n; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % n];
		out.push({
			x: Math.round((0.75 * a.x + 0.25 * b.x) * 10) / 10,
			y: Math.round((0.75 * a.y + 0.25 * b.y) * 10) / 10,
		});
		out.push({
			x: Math.round((0.25 * a.x + 0.75 * b.x) * 10) / 10,
			y: Math.round((0.25 * a.y + 0.75 * b.y) * 10) / 10,
		});
	}
	return ensureClosed(out);
}

/**
 * Apply Chaikin smoothing to a freehand ring.
 * @param points - Polyline (preferably closed)
 * @param iterations - Number of corner-cutting passes (1–5 typical)
 */
export function chaikinSmooth(points: TracePoint[], iterations = 2): TracePoint[] {
	if (points.length < 4) return points;
	let cur = points;
	const n = Math.max(0, Math.min(5, Math.floor(iterations)));
	for (let i = 0; i < n; i++) cur = chaikinPass(cur);
	return decimate(ensureClosed(cur), 280);
}

/**
 * Laplacian / curvature-damping pass on a closed ring.
 * Softens high-frequency jag without collapsing overall band extent — closer to
 * flat biomedical legend-icon edges than raw pointer samples.
 *
 * @param points - Closed polyline
 * @param iterations - Number of damping iterations
 * @param lambda - Blend toward neighbor average (0–0.5 safe)
 */
export function laplacianSmooth(
	points: TracePoint[],
	iterations = 4,
	lambda = 0.33,
): TracePoint[] {
	if (points.length < 4) return points;
	const ring0 =
		dist(points[0], points[points.length - 1]) < 1.5
			? points.slice(0, -1)
			: [...points];
	if (ring0.length < 3) return points;
	let ring = ring0.map((p) => ({ x: p.x, y: p.y }));
	const nIter = Math.max(0, Math.min(12, Math.floor(iterations)));
	const a = Math.max(0.05, Math.min(0.45, lambda));
	for (let iter = 0; iter < nIter; iter++) {
		const next: TracePoint[] = [];
		const n = ring.length;
		for (let i = 0; i < n; i++) {
			const prev = ring[(i - 1 + n) % n];
			const cur = ring[i];
			const nxt = ring[(i + 1) % n];
			const mx = (prev.x + nxt.x) / 2;
			const my = (prev.y + nxt.y) / 2;
			next.push({
				x: Math.round((cur.x * (1 - a) + mx * a) * 10) / 10,
				y: Math.round((cur.y * (1 - a) + my * a) * 10) / 10,
			});
		}
		ring = next;
	}
	return ensureClosed(ring);
}

/**
 * Translate + uniform-scale a source ring into the destination bbox (centered).
 * Used to lightly bias freehand edges toward a legend glyph silhouette.
 *
 * @param source - Glyph contour in arbitrary coords
 * @param dest - Freehand ring whose bbox is the target
 */
function alignRingToBBox(source: TracePoint[], dest: TracePoint[]): TracePoint[] {
	if (source.length < 3 || dest.length < 3) return dest;
	const sRing =
		dist(source[0], source[source.length - 1]) < 1.5
			? source.slice(0, -1)
			: source;
	const dRing =
		dist(dest[0], dest[dest.length - 1]) < 1.5 ? dest.slice(0, -1) : dest;
	const sxs = sRing.map((p) => p.x);
	const sys = sRing.map((p) => p.y);
	const dxs = dRing.map((p) => p.x);
	const dys = dRing.map((p) => p.y);
	const sMinX = Math.min(...sxs);
	const sMaxX = Math.max(...sxs);
	const sMinY = Math.min(...sys);
	const sMaxY = Math.max(...sys);
	const dMinX = Math.min(...dxs);
	const dMaxX = Math.max(...dxs);
	const dMinY = Math.min(...dys);
	const dMaxY = Math.max(...dys);
	const sw = Math.max(1, sMaxX - sMinX);
	const sh = Math.max(1, sMaxY - sMinY);
	const dw = Math.max(1, dMaxX - dMinX);
	const dh = Math.max(1, dMaxY - dMinY);
	const scale = Math.min(dw / sw, dh / sh);
	const sCx = (sMinX + sMaxX) / 2;
	const sCy = (sMinY + sMaxY) / 2;
	const dCx = (dMinX + dMaxX) / 2;
	const dCy = (dMinY + dMaxY) / 2;
	return ensureClosed(
		sRing.map((p) => ({
			x: Math.round((dCx + (p.x - sCx) * scale) * 10) / 10,
			y: Math.round((dCy + (p.y - sCy) * scale) * 10) / 10,
		})),
	);
}

/**
 * Resample a closed ring to `count` uniformly spaced vertices along arc length.
 * @param points - Closed polyline
 * @param count - Target vertex count
 */
function resampleClosed(points: TracePoint[], count: number): TracePoint[] {
	const ring =
		dist(points[0], points[points.length - 1]) < 1.5
			? points.slice(0, -1)
			: points;
	if (ring.length < 3 || count < 3) return points;
	const segLens: number[] = [];
	let total = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		const len = dist(a, b);
		segLens.push(len);
		total += len;
	}
	if (total < 1e-3) return points;
	const out: TracePoint[] = [];
	for (let k = 0; k < count; k++) {
		let target = (k / count) * total;
		let i = 0;
		while (i < segLens.length && target > segLens[i]) {
			target -= segLens[i];
			i++;
		}
		const a = ring[i % ring.length];
		const b = ring[(i + 1) % ring.length];
		const len = segLens[i % segLens.length] || 1;
		const t = target / len;
		out.push({
			x: Math.round((a.x + (b.x - a.x) * t) * 10) / 10,
			y: Math.round((a.y + (b.y - a.y) * t) * 10) / 10,
		});
	}
	return ensureClosed(out);
}

/**
 * Blend freehand vertices toward an aligned legend-glyph contour (expert shape
 * stays dominant). Not a detector — polyline refinement only.
 *
 * @param freehand - Expert outline
 * @param glyph - Legend glyph contour (any coords; aligned into freehand bbox)
 * @param mix - Glyph weight (0–0.35)
 */
export function blendTowardGlyphContour(
	freehand: TracePoint[],
	glyph: TracePoint[],
	mix = 0.16,
): TracePoint[] {
	if (freehand.length < 4 || glyph.length < 4) return freehand;
	const m = Math.max(0, Math.min(0.35, mix));
	if (m <= 0) return freehand;
	const aligned = alignRingToBBox(glyph, freehand);
	const n = Math.max(24, Math.min(160, freehand.length - 1));
	const fh = resampleClosed(freehand, n);
	const gh = resampleClosed(aligned, n);
	const fhRing = fh.slice(0, -1);
	const ghRing = gh.slice(0, -1);
	const blended = fhRing.map((p, i) => ({
		x: Math.round((p.x * (1 - m) + ghRing[i].x * m) * 10) / 10,
		y: Math.round((p.y * (1 - m) + ghRing[i].y * m) * 10) / 10,
	}));
	return ensureClosed(blended);
}

export type AtlasSmoothOptions = {
	/** Legend iconInterpretation — bands get stronger smoothing. */
	iconInterpretation?: string | null;
	/** Optional legend-glyph contour for light silhouette bias. */
	glyphContour?: TracePoint[] | null;
};

/**
 * Atlas-like finish for closed freehand outlines: extra Chaikin + Laplacian,
 * stronger for `multiple-adjacent-as-one` band structures, optional glyph blend.
 *
 * @param points - Cleaned closed outline
 * @param opts - Interpretation / glyph bias
 */
export function atlasSmoothClosedOutline(
	points: TracePoint[],
	opts: AtlasSmoothOptions = {},
): TracePoint[] {
	if (points.length < 4) return points;
	const band =
		opts.iconInterpretation === 'multiple-adjacent-as-one' ||
		opts.iconInterpretation === '2-discrete';
	let cur = chaikinSmooth(points, band ? 3 : 2);
	cur = laplacianSmooth(cur, band ? 6 : 3, band ? 0.36 : 0.28);
	cur = chaikinSmooth(cur, 1);
	if (opts.glyphContour && opts.glyphContour.length >= 8) {
		cur = blendTowardGlyphContour(cur, opts.glyphContour, band ? 0.18 : 0.12);
		cur = chaikinSmooth(cur, 1);
		cur = laplacianSmooth(cur, 2, 0.25);
	}
	return decimate(ensureClosed(cur), 220);
}

/**
 * Extract an outer ink contour from a legend glyph image (browser only).
 * White-card templates use alpha or dark ink — not used for matching.
 *
 * @param glyphUrl - Glyph / template asset URL
 */
export async function extractGlyphContour(
	glyphUrl: string,
): Promise<TracePoint[] | null> {
	if (typeof document === 'undefined') return null;
	try {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('glyph load failed'));
			img.src = glyphUrl;
		});
		const w = img.naturalWidth || 64;
		const h = img.naturalHeight || 64;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0);
		const { data } = ctx.getImageData(0, 0, w, h);
		const mask = new Uint8Array(w * h);
		for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
			const a = data[p + 3];
			const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
			// Ink: opaque dark, or any non-trivial alpha on transparent cards.
			mask[i] = a > 40 && lum < 245 ? 1 : 0;
		}
		morphClose(mask, w, h, 1);
		const contour = mooreContour(mask, w, h);
		if (contour.length < 8) return null;
		return decimate(
			ensureClosed(
				contour.map((p) => ({
					x: Math.round(p.x * 10) / 10,
					y: Math.round(p.y * 10) / 10,
				})),
			),
			120,
		);
	} catch {
		return null;
	}
}

/**
 * Luminance of an sRGB pixel (rec. 601), 0–255.
 * @param data - RGBA buffer
 * @param idx - Byte offset of the R channel
 */
function lumaAt(data: Uint8ClampedArray, idx: number): number {
	return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

/**
 * Simple Sobel-ish gradient magnitude at (x, y) for high-contrast outline detection.
 * Flat biomedical atlas art has strong slate outlines on pale grounds — those peaks
 * are the snap targets. Not used for template matching.
 *
 * @param data - RGBA ImageData buffer
 * @param w - Image width
 * @param h - Image height
 * @param x - Sample x
 * @param y - Sample y
 */
function gradientMag(
	data: Uint8ClampedArray,
	w: number,
	h: number,
	x: number,
	y: number,
): number {
	if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
	const i = (yy: number, xx: number) => lumaAt(data, (yy * w + xx) * 4);
	const gx =
		-i(y - 1, x - 1) +
		i(y - 1, x + 1) -
		2 * i(y, x - 1) +
		2 * i(y, x + 1) -
		i(y + 1, x - 1) +
		i(y + 1, x + 1);
	const gy =
		-i(y - 1, x - 1) -
		2 * i(y - 1, x) -
		i(y - 1, x + 1) +
		i(y + 1, x - 1) +
		2 * i(y + 1, x) +
		i(y + 1, x + 1);
	return Math.hypot(gx, gy);
}

/**
 * Unit outward normal at ring vertex i (average of adjacent edge normals).
 * @param ring - Open ring (no duplicate close vertex)
 * @param i - Vertex index
 */
function outwardNormal(ring: TracePoint[], i: number): { x: number; y: number } {
	const n = ring.length;
	const prev = ring[(i - 1 + n) % n];
	const cur = ring[i];
	const next = ring[(i + 1) % n];
	const e1x = cur.x - prev.x;
	const e1y = cur.y - prev.y;
	const e2x = next.x - cur.x;
	const e2y = next.y - cur.y;
	let nx = -(e1y + e2y);
	let ny = e1x + e2x;
	const len = Math.hypot(nx, ny) || 1;
	return { x: nx / len, y: ny / len };
}

/**
 * Signed area of a closed ring (positive ≈ CCW).
 * @param ring - Open ring
 */
function signedArea(ring: TracePoint[]): number {
	let a = 0;
	const n = ring.length;
	for (let i = 0; i < n; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % n];
		a += p.x * q.y - q.x * p.y;
	}
	return a / 2;
}

/**
 * One active-contour-style pass: attract each vertex along its local normal
 * (inward and outward) to the strongest nearby luminance edge. Classic snake /
 * morphological edge-hug for flat biomedical atlas art — not a match detector.
 *
 * @param points - Closed outline in native cutaway coords
 * @param image - Cutaway ImageData
 * @param radius - Search half-width along the normal in native px
 * @param maxStep - Cap on how far a vertex may move this pass
 */
function snapOutlinePass(
	points: TracePoint[],
	image: ImageData,
	radius: number,
	maxStep: number,
): TracePoint[] {
	const { data, width: w, height: h } = image;
	const ring =
		dist(points[0], points[points.length - 1]) < 1.5
			? points.slice(0, -1)
			: points;
	if (ring.length < 3) return points;

	const ccw = signedArea(ring) > 0;
	const outwardSign = ccw ? 1 : -1;

	const snapped = ring.map((p, i) => {
		const nrm = outwardNormal(ring, i);
		const nx = nrm.x * outwardSign;
		const ny = nrm.y * outwardSign;
		let bestX = p.x;
		let bestY = p.y;
		let bestG = gradientMag(data, w, h, Math.round(p.x), Math.round(p.y));
		const r = Math.max(1, Math.floor(radius));
		for (let s = -r; s <= r; s++) {
			if (s === 0) continue;
			for (const lat of [0, -1, 1]) {
				const tx = p.x + nx * s + -ny * lat * 0.6;
				const ty = p.y + ny * s + nx * lat * 0.6;
				if (tx < 1 || ty < 1 || tx >= w - 1 || ty >= h - 1) continue;
				const g = gradientMag(data, w, h, Math.round(tx), Math.round(ty));
				if (g > bestG) {
					bestG = g;
					bestX = tx;
					bestY = ty;
				}
			}
		}
		const ddx = bestX - p.x;
		const ddy = bestY - p.y;
		const step = Math.hypot(ddx, ddy);
		if (step <= 0.2 || bestG < EDGE_SNAP_MIN_GRAD) return p;
		const scale = step > maxStep ? maxStep / step : 1;
		return {
			x: Math.round((p.x + ddx * scale) * 10) / 10,
			y: Math.round((p.y + ddy * scale) * 10) / 10,
		};
	});

	return ensureClosed(snapped);
}

/**
 * Nudge each outline vertex toward the strongest nearby luminance edge using
 * multi-pass normal-directed search (active-contour / snake style).
 * Hugs slate atlas outlines without inventing a detector for match pipelines.
 *
 * @param points - Closed outline in native cutaway coords
 * @param image - Cutaway ImageData decoded from the same cutaway asset the
 * points were captured against, so both already share one pixel space
 * @param radius - Search radius in native px
 * @param maxStep - Cap on how far a vertex may move per pass
 * @param passes - Number of attraction iterations
 */
export function snapOutlineToEdges(
	points: TracePoint[],
	image: ImageData,
	radius = EDGE_SNAP_RADIUS,
	maxStep = EDGE_SNAP_MAX_STEP,
	passes = EDGE_SNAP_PASSES,
): TracePoint[] {
	if (points.length < 3 || !image?.data) return points;
	let cur = points;
	const n = Math.max(1, Math.min(5, Math.floor(passes)));
	for (let i = 0; i < n; i++) {
		const r = Math.max(3, Math.round(radius * (1 - i * 0.2)));
		const step = Math.max(2, maxStep - i);
		cur = snapOutlinePass(cur, image, r, step);
	}
	return chaikinSmooth(ensureClosed(cur), 1);
}

/**
 * Decode a cutaway image URL into ImageData for edge snapping (browser only).
 * @param url - Absolute or same-origin cutaway asset URL
 */
export async function loadCutawayImageData(url: string): Promise<ImageData | null> {
	if (typeof document === 'undefined') return null;
	try {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('cutaway image load failed'));
			img.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth || CUTAWAY_W;
		canvas.height = img.naturalHeight || CUTAWAY_H;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0);
		return ctx.getImageData(0, 0, canvas.width, canvas.height);
	} catch {
		return null;
	}
}

export type RefineFreehandOptions = AtlasSmoothOptions & {
	/** Optional legend glyph URL for silhouette bias (existing codes). */
	glyphUrl?: string | null;
};

/**
 * Smooth + optionally snap a cleaned freehand outline to cutaway ink edges,
 * then apply atlas Chaikin/Laplacian (and optional legend-glyph bias).
 * Falls back to atlas smooth only when the cutaway image cannot be decoded.
 *
 * @param points - Cleaned closed outline
 * @param cutawayUrl - Optional cutaway asset URL for edge hug
 * @param opts - iconInterpretation / glyph bias
 */
export async function refineFreehandOutline(
	points: TracePoint[],
	cutawayUrl?: string | null,
	opts: RefineFreehandOptions = {},
): Promise<TracePoint[]> {
	let cur = points;
	if (cutawayUrl) {
		const image = await loadCutawayImageData(cutawayUrl);
		if (image) cur = snapOutlineToEdges(chaikinSmooth(cur, 1), image);
	}
	let glyphContour = opts.glyphContour ?? null;
	if (!glyphContour && opts.glyphUrl) {
		glyphContour = await extractGlyphContour(opts.glyphUrl);
	}
	return atlasSmoothClosedOutline(cur, {
		iconInterpretation: opts.iconInterpretation,
		glyphContour,
	});
}

/**
 * Render a legend-glyph-style square icon: cutaway crop under the freehand mask
 * on a white card (similar to extracted legend templates). Browser only.
 *
 * @param points - Closed outline in native cutaway coords
 * @param cutawayUrl - Cutaway asset URL
 * @param size - Output square size in CSS pixels
 * @returns PNG as raw base64 (no data: prefix), or null on failure
 */
export async function renderFreehandLegendIcon(
	points: TracePoint[],
	cutawayUrl: string,
	size = 64,
): Promise<string | null> {
	if (typeof document === 'undefined' || points.length < 3) return null;
	try {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('cutaway image load failed'));
			img.src = cutawayUrl;
		});
		const natW = img.naturalWidth || CUTAWAY_W;
		const natH = img.naturalHeight || CUTAWAY_H;

		const ring =
			dist(points[0], points[points.length - 1]) < 1.5
				? points.slice(0, -1)
				: points;
		const xs = ring.map((p) => p.x);
		const ys = ring.map((p) => p.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const bw = Math.max(4, maxX - minX);
		const bh = Math.max(4, maxY - minY);
		const pad = Math.max(4, Math.round(Math.max(bw, bh) * 0.12));
		const cropX = Math.max(0, minX - pad);
		const cropY = Math.max(0, minY - pad);
		const cropW = Math.min(natW - cropX, bw + pad * 2);
		const cropH = Math.min(natH - cropY, bh + pad * 2);

		const src = document.createElement('canvas');
		src.width = Math.max(1, Math.round(cropW));
		src.height = Math.max(1, Math.round(cropH));
		const sctx = src.getContext('2d');
		if (!sctx) return null;
		sctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, src.width, src.height);

		sctx.globalCompositeOperation = 'destination-in';
		sctx.beginPath();
		for (let i = 0; i < ring.length; i++) {
			const px = ring[i].x - cropX;
			const py = ring[i].y - cropY;
			if (i === 0) sctx.moveTo(px, py);
			else sctx.lineTo(px, py);
		}
		sctx.closePath();
		sctx.fill();
		sctx.globalCompositeOperation = 'source-over';

		const out = document.createElement('canvas');
		out.width = size;
		out.height = size;
		const octx = out.getContext('2d');
		if (!octx) return null;
		octx.fillStyle = '#ffffff';
		octx.fillRect(0, 0, size, size);
		octx.strokeStyle = '#e2e8e4';
		octx.lineWidth = 1;
		octx.strokeRect(0.5, 0.5, size - 1, size - 1);

		const margin = Math.round(size * 0.1);
		const fit = Math.min(
			(size - margin * 2) / src.width,
			(size - margin * 2) / src.height,
		);
		const dw = src.width * fit;
		const dh = src.height * fit;
		const dx = (size - dw) / 2;
		const dy = (size - dh) / 2;
		octx.drawImage(src, dx, dy, dw, dh);

		const dataUrl = out.toDataURL('image/png');
		const comma = dataUrl.indexOf(',');
		return comma >= 0 ? dataUrl.slice(comma + 1) : null;
	} catch {
		return null;
	}
}
