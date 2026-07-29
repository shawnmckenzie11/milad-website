/**
 * Tier verification tallies, graduation thresholds, and progress rollups
 * for the maintainer Pipeline tab.
 */
import type {
	Annotation,
	ItemTallyStatus,
	LegendItemRow,
	TierGraduation,
	TierProgressSnapshot,
	TrainingFeedback,
} from '../types';
import { collectFalsePositiveHits, hitKey, itemsWithoutPurgedHits } from './purgedHits';

/** Correct-location coverage required to mark a tier "good". */
export const TIER_GOOD_CORRECT_PCT = 0.9;

/** Max false-positive rate (among reviewed hits) allowed for "good". */
export const TIER_GOOD_MAX_FP_PCT = 0.05;

const LOCATION_WRONG_RE =
	/\b(location\s+(is\s+)?not\s+correct|wrong\s+location|incorrect\s+location|relocate|moved)\b/i;
const PENDING_MORE_RE = /\b(one\s+more|still\s+missing|not\s+found|missed|another\s+\w*\s*\d)\b/i;

/**
 * Infer a per-item tally status from annotations, geometry feedback, and free-text notes.
 * Prefers explicit structured fields; falls back to label / note heuristics.
 *
 * @param code - Legend code
 * @param annotations - All persisted hit annotations
 * @param feedback - Training / review feedback entries
 */
export function inferItemTallyStatus(
	code: string,
	annotations: Annotation[],
	feedback: TrainingFeedback[],
): ItemTallyStatus {
	const codeAnns = annotations.filter(
		(a) => a.code === code || a.reassignedCode === code,
	);
	const codeFb = feedback.filter((f) => f.code === code);

	const explicitCorrect =
		codeAnns.some((a) => a.locationStatus === 'correct-location') ||
		codeFb.some((f) => f.kind === 'correct-location' || f.kind === 'confirmed');
	const explicitWrong =
		codeAnns.some((a) => a.locationStatus === 'wrong-location') ||
		codeFb.some(
			(f) =>
				f.kind === 'wrong-location' ||
				f.kind === 'relocate' ||
				f.kind === 'resize' ||
				f.kind === 'trace',
		);
	const explicitPending =
		codeAnns.some((a) => a.locationStatus === 'pending-miss') ||
		codeFb.some((f) => f.kind === 'pending-miss');

	const notes = [
		...codeAnns.map((a) => a.note || ''),
		...codeFb.map((f) => f.note || ''),
	].join('\n');

	if (explicitCorrect || codeAnns.some((a) => a.label === 'confirmed')) {
		if (LOCATION_WRONG_RE.test(notes) && !explicitCorrect) {
			return 'wrong-location';
		}
		return 'correct-location';
	}

	if (explicitWrong || LOCATION_WRONG_RE.test(notes)) {
		return 'wrong-location';
	}

	if (explicitPending || PENDING_MORE_RE.test(notes)) {
		return 'pending';
	}

	return 'pending';
}

/**
 * Whether a match instance is locked (confirmed) and should not accept edits.
 * @param ann - Annotation for the instance, if any
 */
export function isConfirmedLocked(ann: Annotation | undefined): boolean {
	return ann?.label === 'confirmed';
}

/**
 * Compute progress for one observability tier from legend items + review data.
 *
 * Definitions (shown in UI tooltips):
 * - Correctness: share of searchable codes in the tier with ≥1 correct-location
 *   confirmation (or inferred confirmed annotation).
 * - FP rate: archived false-positive events / (active confirmed|reassigned + FPs)
 *   among hits whose code is in this tier. FP hits are purged from active tables
 *   but still count toward the rate via training-feedback archive entries.
 *
 * @param tier - Observability tier number (1–3; 0 = skip)
 * @param items - Merged legend rows
 * @param annotations - Active hit review annotations (confirmed / reassigned)
 * @param feedback - Geometry / structured / FP-archive feedback
 */
export function computeTierProgress(
	tier: number,
	items: LegendItemRow[],
	annotations: Annotation[],
	feedback: TrainingFeedback[],
): TierProgressSnapshot {
	const activeItems = itemsWithoutPurgedHits(items, feedback, annotations);
	const tierItems = activeItems.filter((i) => i.tier === tier);
	const searchable = tierItems.filter((i) => i.searchable !== false && tier > 0);
	const denomItems = searchable.length > 0 ? searchable : tierItems;

	const itemStatuses = denomItems.map((item) => {
		const status = inferItemTallyStatus(item.code, annotations, feedback);
		const hasHits = (item.instances?.length || item.instanceCount || 0) > 0;
		let resolved: ItemTallyStatus = status;
		if (status === 'pending' && !hasHits) resolved = 'pending';
		if (
			status === 'pending' &&
			hasHits &&
			!annotations.some((a) => a.code === item.code && a.label !== 'false-positive')
		) {
			resolved = 'pending';
		}
		return { code: item.code, name: item.name, status: resolved, hasHits };
	});

	const correctCount = itemStatuses.filter((s) => s.status === 'correct-location').length;
	const wrongCount = itemStatuses.filter((s) => s.status === 'wrong-location').length;
	const pendingCount = itemStatuses.filter((s) => s.status === 'pending').length;
	const expected = denomItems.length || 1;
	const correctnessPct = correctCount / expected;

	const tierCodes = new Set(denomItems.map((i) => i.code));
	const reviewedActive = annotations.filter(
		(a) =>
			tierCodes.has(a.code) &&
			(a.label === 'confirmed' || a.label === 'reassigned'),
	);
	// Unique FP archive hits for this tier (dedupe repeated mark events; ignore hard deletes).
	const purged = collectFalsePositiveHits(feedback, annotations).filter((p) =>
		tierCodes.has(p.code),
	);
	const fpKeys = new Set(purged.map((p) => hitKey(p.code, p.cx, p.cy)));
	const fpCount = fpKeys.size;
	const reviewedCount = reviewedActive.length + fpCount;
	const fpRate = reviewedCount > 0 ? fpCount / reviewedCount : 0;

	const graduation = evaluateGraduation(correctnessPct, fpRate, reviewedCount);

	return {
		tier,
		label: tierLabel(tier),
		itemStatuses,
		correctCount,
		wrongCount,
		pendingCount,
		expected: denomItems.length,
		correctnessPct,
		fpCount,
		reviewedCount,
		fpRate,
		graduation,
		detectedInstances: denomItems.reduce(
			(n, i) => n + (i.instances?.length || i.instanceCount || 0),
			0,
		),
	};
}

/**
 * Apply graduation thresholds for a tier.
 * @param correctnessPct - Fraction of codes with ≥1 correct-location find
 * @param fpRate - FP annotations / reviewed annotations
 * @param reviewedCount - Number of reviewed hits (denominator for FP)
 */
export function evaluateGraduation(
	correctnessPct: number,
	fpRate: number,
	reviewedCount: number,
): TierGraduation {
	const correctOk = correctnessPct >= TIER_GOOD_CORRECT_PCT;
	const fpOk = reviewedCount === 0 ? false : fpRate < TIER_GOOD_MAX_FP_PCT;
	return {
		good: correctOk && fpOk,
		correctOk,
		fpOk,
		thresholds: {
			minCorrectPct: TIER_GOOD_CORRECT_PCT,
			maxFpPct: TIER_GOOD_MAX_FP_PCT,
		},
	};
}

/**
 * Human label for an observability tier.
 * @param tier - Tier number
 */
export function tierLabel(tier: number): string {
	if (tier === 1) return 'Tier 1 · exact replicas';
	if (tier === 2) return 'Tier 2 · partial / neighbour';
	if (tier === 3) return 'Tier 3 · scale-divergent';
	if (tier === 0) return 'Tier 0 · skip';
	return `Tier ${tier}`;
}

/**
 * Codes belonging to the active Tier to Test verification set.
 * @param items - Legend rows
 * @param tierToTest - Selected tier
 */
export function codesForTier(items: LegendItemRow[], tierToTest: number): Set<string> {
	return new Set(items.filter((i) => i.tier === tierToTest).map((i) => i.code));
}

/** Searchable observability tiers included in multi-tier RL feedback exports. */
export const RL_FEEDBACK_TIERS = [1, 2, 3] as const;

/**
 * Codes belonging to one or more tiers (e.g. all searchable tiers for RL export).
 * @param items - Legend rows
 * @param tiers - Tier numbers to include
 */
export function codesForTierList(items: LegendItemRow[], tiers: readonly number[]): Set<string> {
	const want = new Set(tiers);
	return new Set(
		items.filter((i) => i.tier != null && want.has(i.tier)).map((i) => i.code),
	);
}

/**
 * Compact percent string for UI (e.g. 87%).
 * @param ratio - 0–1 fraction
 */
export function pct(ratio: number): string {
	if (!Number.isFinite(ratio)) return '—';
	return `${Math.round(ratio * 1000) / 10}%`;
}
