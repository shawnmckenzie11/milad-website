/**
 * Helpers for suppressing false-positive and user-deleted match hits from
 * active review tables and cutaway overlays. FP events remain in training
 * feedback for RL prompts; deleted markers only suppress UI / active datasets.
 */
import type { Annotation, FindingInstance, LegendItemRow, TrainingFeedback } from '../types';

/** Pixel tolerance when matching a hit center to a purged FP coordinate. */
export const PURGE_HIT_TOL = 1.5;

export type PurgedHitReason = 'false-positive' | 'deleted';

export type PurgedHit = {
	code: string;
	cx: number;
	cy: number;
	/** Why this center is hidden from active views. */
	reason: PurgedHitReason;
};

/**
 * Round coordinates the same way annotation ids / feedback centers do.
 * @param n - Pixel coordinate
 */
export function roundHitCoord(n: number): number {
	return Math.round(n * 10) / 10;
}

/**
 * Stable string key for a match center (debugging / Set membership).
 * @param code - Legend code
 * @param cx - Center x
 * @param cy - Center y
 */
export function hitKey(code: string, cx: number, cy: number): string {
	return `${code}:${roundHitCoord(cx)}:${roundHitCoord(cy)}`;
}

/**
 * Whether two centers refer to the same match within purge tolerance.
 * @param ax - First x
 * @param ay - First y
 * @param bx - Second x
 * @param by - Second y
 * @param tol - Max distance in px
 */
export function centersNear(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	tol = PURGE_HIT_TOL,
): boolean {
	return Math.abs(ax - bx) < tol && Math.abs(ay - by) < tol;
}

/**
 * Collect centers that should be hidden from active tables / overlays:
 * archived FPs plus hard-deleted Database View rows.
 *
 * @param feedback - Training / review feedback (FP archive + deleted markers)
 * @param annotations - Active annotations (may briefly still contain FPs)
 */
export function collectPurgedHits(
	feedback: TrainingFeedback[],
	annotations: Annotation[] = [],
): PurgedHit[] {
	const out: PurgedHit[] = [];
	const seen = new Set<string>();

	/**
	 * Push a unique suppressed center (first reason wins).
	 * @param code - Legend code
	 * @param cx - Center x
	 * @param cy - Center y
	 * @param reason - Suppression reason
	 */
	function add(code: string, cx: number, cy: number, reason: PurgedHitReason) {
		const key = hitKey(code, cx, cy);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ code, cx, cy, reason });
	}

	for (const f of feedback) {
		if (f.kind === 'false-positive') {
			if (f.from?.cx == null || f.from?.cy == null) continue;
			add(f.code, f.from.cx, f.from.cy, 'false-positive');
		} else if (f.kind === 'deleted') {
			if (f.from?.cx == null || f.from?.cy == null) continue;
			add(f.code, f.from.cx, f.from.cy, 'deleted');
		}
	}
	for (const a of annotations) {
		if (a.label !== 'false-positive') continue;
		add(a.code, a.cx, a.cy, 'false-positive');
	}
	return out;
}

/**
 * Legend codes whose Database View placeholder rows were maintainer-purged.
 * Hides pending / no-hit `item-{code}` rows after delete.
 * @param feedback - Training feedback
 */
export function collectSuppressedCodes(feedback: TrainingFeedback[]): Set<string> {
	const out = new Set<string>();
	for (const f of feedback) {
		if (f.kind === 'deleted-code' && f.code) out.add(f.code);
	}
	return out;
}

/**
 * Whether a legend code’s empty placeholder should stay hidden.
 * @param code - Legend code
 * @param suppressed - Codes from collectSuppressedCodes
 */
export function isCodeSuppressed(code: string, suppressed: Set<string>): boolean {
	return suppressed.has(code);
}

/**
 * FP-only purged centers for graduation / FP-rate math (excludes hard deletes).
 * @param feedback - Training feedback
 * @param annotations - Active annotations
 */
export function collectFalsePositiveHits(
	feedback: TrainingFeedback[],
	annotations: Annotation[] = [],
): PurgedHit[] {
	return collectPurgedHits(feedback, annotations).filter((p) => p.reason === 'false-positive');
}

/**
 * Whether a match center was classified as a false positive or deleted.
 * @param code - Legend code
 * @param cx - Center x
 * @param cy - Center y
 * @param purged - Collected purged centers
 */
export function isHitPurged(
	code: string,
	cx: number,
	cy: number,
	purged: PurgedHit[],
): boolean {
	return purged.some((p) => p.code === code && centersNear(cx, cy, p.cx, p.cy));
}

/**
 * Drop purged instances from a legend row's instance list.
 * @param code - Legend code for the instances
 * @param instances - Match instances from findings
 * @param purged - Collected purged centers
 */
export function filterActiveInstances(
	code: string,
	instances: FindingInstance[],
	purged: PurgedHit[],
): FindingInstance[] {
	if (purged.length === 0) return instances;
	return instances.filter((inst) => {
		const cx = inst.cx ?? 0;
		const cy = inst.cy ?? 0;
		return !isHitPurged(code, cx, cy, purged);
	});
}

/**
 * Clone legend rows with purged FP / deleted hits removed from `instances` / counts.
 * Use for Review overlays, hit lists, and layer chip counts.
 *
 * @param items - Full legend rows with match instances
 * @param feedback - Training feedback (FP archive + deleted markers)
 * @param annotations - Active annotations (migration fallback)
 */
export function itemsWithoutPurgedHits(
	items: LegendItemRow[],
	feedback: TrainingFeedback[],
	annotations: Annotation[] = [],
): LegendItemRow[] {
	const purged = collectPurgedHits(feedback, annotations);
	if (purged.length === 0) return items;
	return items.map((it) => {
		const instances = it.instances || [];
		const next = filterActiveInstances(it.code, instances, purged);
		if (next.length === instances.length) return it;
		return {
			...it,
			instances: next,
			instanceCount: next.length,
		};
	});
}
