/**
 * Reconcile expert freehand-classify outlines with OpenCV match hits.
 *
 * Heuristic (post-rematch and on analysis restore):
 * - Compatible (near centroid + similar size) → drop freehand; keep match only.
 *   Treat as a successful recovery — never leave freehand+hit duplicates.
 * - Incompatible (far or wrong shape/scale) → reject match; keep freehand GT.
 *
 * Failure modes this closes (A1/B1 RL):
 * - Tiny wrong-shape stamps near a large band centroid (sizeRatio gate).
 * - Stale analysis snapshots that still had both rows after a good rematch.
 * - Judging a multi-instance code by its first reported match only, which
 *   rejected a valid distant instance (A1 mid-stem) against a lumen-band outline.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { storeFor } from './analyses.mjs';

/** Max distance (px) between match and freehand centroids for a “same place” hit. */
export const FREEHAND_MATCH_CENTROID_MAX_DIST = 40;

/**
 * Match window max-side / freehand bbox max-side must fall in this band to
 * count as the same shape scale (rejects tiny glyph stamps on large bands).
 */
export const FREEHAND_MATCH_SIZE_RATIO_MIN = 0.4;
export const FREEHAND_MATCH_SIZE_RATIO_MAX = 2.5;

/**
 * How close a match must be to *contest* a freehand outline.
 *
 * `multiple-adjacent-as-one` codes (A1/B1) legitimately have several instances:
 * A1 owns both the mid-stem glyph (~376,71) and the lumen band (~710,219). Only
 * hits competing for the freehand's own locus may be rejected against it —
 * distant instances of the same code are untouched.
 */
export const FREEHAND_MATCH_CONTEST_DIST = 120;

/**
 * @param {Array<{x:number,y:number}> | null | undefined} points
 * @returns {{ cx: number, cy: number, w: number, h: number } | null}
 */
export function summarizeFreehandPoints(points) {
	if (!Array.isArray(points) || points.length === 0) return null;
	let sx = 0;
	let sy = 0;
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const p of points) {
		const x = Number(p.x);
		const y = Number(p.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		sx += x;
		sy += y;
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	}
	const n = points.length;
	if (!Number.isFinite(x0) || n === 0) return null;
	return {
		cx: sx / n,
		cy: sy / n,
		w: Math.max(1, x1 - x0),
		h: Math.max(1, y1 - y0),
	};
}

/**
 * Classify one match against one freehand geometry summary.
 * @param {{ cx: number, cy: number, w?: number, h?: number }} match
 * @param {{ cx: number, cy: number, w: number, h: number }} freehand
 * @returns {'compatible' | 'incompatible'}
 */
export function classifyMatchVsFreehand(match, freehand) {
	const dist = Math.hypot(match.cx - freehand.cx, match.cy - freehand.cy);
	const matchSide = Math.max(Number(match.w) || 0, Number(match.h) || 0, 1);
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
 * True when the match window overlaps the freehand bbox or its center sits
 * within {@link FREEHAND_MATCH_CONTEST_DIST}. Non-contesting matches belong to a
 * different instance of the same legend code and must survive reconcile.
 *
 * @param {{ cx: number, cy: number, w?: number, h?: number }} match
 * @param {{ cx: number, cy: number, w: number, h: number }} freehand
 * @returns {boolean}
 */
export function matchContestsFreehand(match, freehand) {
	if (Math.hypot(match.cx - freehand.cx, match.cy - freehand.cy) <= FREEHAND_MATCH_CONTEST_DIST) {
		return true;
	}
	const mw = (Number(match.w) || 0) / 2;
	const mh = (Number(match.h) || 0) / 2;
	const fw = freehand.w / 2;
	const fh = freehand.h / 2;
	return Math.abs(match.cx - freehand.cx) <= mw + fw && Math.abs(match.cy - freehand.cy) <= mh + fh;
}

/**
 * @param {string} filePath
 * @returns {Promise<object | null>}
 */
async function loadJson(filePath) {
	try {
		return JSON.parse(await fsp.readFile(filePath, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
async function saveJson(filePath, data) {
	await fsp.mkdir(path.dirname(filePath), { recursive: true });
	await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Remove a findings instance near (cx, cy).
 * @param {object} findings
 * @param {string} code
 * @param {number} cx
 * @param {number} cy
 */
function removeFindingInstance(findings, code, cx, cy) {
	const item = findings?.items?.[code];
	if (!item || !Array.isArray(item.instances)) return false;
	const before = item.instances.length;
	item.instances = item.instances.filter(
		(inst) => Math.hypot((inst.cx ?? 0) - cx, (inst.cy ?? 0) - cy) >= 1.5,
	);
	if (item.instances.length === before) return false;
	item.instanceCount = item.instances.length;
	if (item.instances.length === 0) {
		item.bestScore = null;
		if (item.status === 'found') item.status = 'missed';
	} else {
		item.bestScore = Math.max(...item.instances.map((i) => Number(i.score) || 0));
	}
	return true;
}

/**
 * Reconcile one analysis's freehand outlines against its own match report.
 *
 * Every read and write is resolved from `analysisId`, so a reconcile pass for
 * the analysis a job ran on stays correct even if the operator has since opened
 * a different analysis in the UI.
 *
 * @param {{ analysisId?: string | null }} [opts] - Analysis to reconcile; omit
 *   for defaults mode (the checked-in site store)
 * @returns {Promise<{
 *   supersededFreehands: Array<{ id: string, code: string, match: object }>,
 *   rejectedMatches: Array<{ code: string, cx: number, cy: number, reason: string }>,
 *   log: string[],
 * }>}
 */
export async function reconcileFreehandWithMatches(opts = {}) {
	const now = new Date().toISOString();
	const log = [];
	const supersededFreehands = [];
	const rejectedMatches = [];
	const store = storeFor(opts.analysisId);

	const feedbackDoc = (await loadJson(store.trainingFeedback)) || { feedback: [] };
	const findings = (await loadJson(store.findings)) || { items: {} };
	const report = (await loadJson(store.matchReport)) || { layers: {} };
	let feedbackList = Array.isArray(feedbackDoc.feedback) ? [...feedbackDoc.feedback] : [];

	/** @type {Map<string, object[]>} code → every accepted match from the report */
	const reportByCode = new Map();
	for (const layer of Object.values(report.layers || {})) {
		const code = layer?.legendCode;
		const matches = Array.isArray(layer?.matches) ? layer.matches : [];
		if (!code || matches.length === 0) continue;
		reportByCode.set(code, matches);
	}

	const freehands = feedbackList.filter((f) => f?.kind === 'freehand-classify');
	/** id → the match that took the outline over (entry is retired, not dropped). */
	const freehandIdsToRetire = new Map();

	for (const fh of freehands) {
		const code = fh.code;
		const geo = summarizeFreehandPoints(fh.points);
		if (!geo || !code) continue;

		const source =
			reportByCode.get(code) ??
			(findings.items?.[code]?.instances || []).map((inst) => ({
				cx: inst.cx,
				cy: inst.cy,
				w: inst.w ?? inst.width,
				h: inst.h ?? inst.height,
				score: inst.score,
			}));

		const candidates = (source || [])
			.map((m) => ({
				cx: Number(m.cx),
				cy: Number(m.cy),
				w: Number(m.w) || 0,
				h: Number(m.h) || 0,
				score: m.score,
			}))
			.filter((m) => Number.isFinite(m.cx) && Number.isFinite(m.cy));

		// Only hits competing for this outline's locus are reconciled against it;
		// other instances of the same code (e.g. A1 mid-stem) stay untouched.
		const contesting = candidates
			.filter((m) => matchContestsFreehand(m, geo))
			.sort((a, b) => Math.hypot(a.cx - geo.cx, a.cy - geo.cy) - Math.hypot(b.cx - geo.cx, b.cy - geo.cy));

		if (contesting.length === 0) {
			log.push(`· ${code}: freehand kept (no algorithm hit at this locus)`);
			continue;
		}

		const compatible = contesting.find((m) => classifyMatchVsFreehand(m, geo) === 'compatible');

		if (compatible) {
			const dist = Math.hypot(compatible.cx - geo.cx, compatible.cy - geo.cy);
			const sizeRatio = Math.max(compatible.w, compatible.h, 1) / Math.max(geo.w, geo.h, 1);
			freehandIdsToRetire.set(fh.id, compatible);
			supersededFreehands.push({ id: fh.id, code, match: compatible });
			log.push(
				`· ${code}: freehand superseded by match @ ` +
					`(${compatible.cx.toFixed(0)},${compatible.cy.toFixed(0)}) ` +
					`dist=${dist.toFixed(1)} sizeRatio=${sizeRatio.toFixed(2)}`,
			);
			continue;
		}

		for (const match of contesting) {
			const dist = Math.hypot(match.cx - geo.cx, match.cy - geo.cy);
			const sizeRatio = Math.max(match.w, match.h, 1) / Math.max(geo.w, geo.h, 1);
			const alreadyDeleted = feedbackList.some(
				(f) =>
					f.kind === 'deleted' &&
					f.code === code &&
					f.from &&
					Math.hypot(f.from.cx - match.cx, f.from.cy - match.cy) < 1.5,
			);
			if (!alreadyDeleted) {
				feedbackList.push({
					id: `deleted-${code}:${match.cx}:${match.cy}-reconcile-${Date.now()}`,
					code,
					kind: 'deleted',
					from: { cx: match.cx, cy: match.cy },
					to: null,
					points: null,
					note:
						`Rejected vs freehand GT (centroid dist ${dist.toFixed(1)}px, ` +
						`sizeRatio ${sizeRatio.toFixed(2)}; need dist≤${FREEHAND_MATCH_CENTROID_MAX_DIST} ` +
						`and sizeRatio ${FREEHAND_MATCH_SIZE_RATIO_MIN}–${FREEHAND_MATCH_SIZE_RATIO_MAX})`,
					createdAt: now,
				});
			}
			removeFindingInstance(findings, code, match.cx, match.cy);
			rejectedMatches.push({
				code,
				cx: match.cx,
				cy: match.cy,
				reason: `dist=${dist.toFixed(1)} sizeRatio=${sizeRatio.toFixed(2)}`,
			});
			log.push(
				`· ${code}: match @ (${match.cx.toFixed(0)},${match.cy.toFixed(0)}) rejected vs freehand ` +
					`(dist=${dist.toFixed(1)}, sizeRatio=${sizeRatio.toFixed(2)}); freehand kept`,
			);
		}
	}

	if (freehandIdsToRetire.size > 0) {
		const retired = feedbackList.filter((f) => freehandIdsToRetire.has(f.id));
		// Retire rather than delete: the vertices remain the matcher's Tier-2
		// band template source, so a later rematch can still reproduce the hit.
		feedbackList = feedbackList.map((f) => {
			const match = freehandIdsToRetire.get(f.id);
			if (!match) return f;
			return {
				...f,
				kind: 'freehand-superseded',
				iconRel: null,
				supersededBy: { cx: match.cx, cy: match.cy, score: match.score ?? null },
				supersededAt: now,
			};
		});
		for (const entry of retired) {
			if (!entry?.iconRel) continue;
			// Icons live in this analysis's own freehand-icons dir; match by basename
			// so a legacy repo-relative iconRel still resolves.
			await fsp
				.unlink(path.join(store.freehandIcons, path.basename(String(entry.iconRel))))
				.catch(() => {});
		}
	}

	if (supersededFreehands.length > 0 || rejectedMatches.length > 0) {
		await saveJson(store.trainingFeedback, {
			feedback: feedbackList,
			updatedAt: now,
			lastReconcileAt: now,
		});
		findings.meta = {
			...(findings.meta || {}),
			updatedAt: now,
			lastFreehandReconcileAt: now,
		};
		await saveJson(store.findings, findings);
	}

	return { supersededFreehands, rejectedMatches, log };
}
