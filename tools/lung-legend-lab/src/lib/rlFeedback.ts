/**
 * Build a delta RL / chat-style feedback prompt from owner review since the
 * last exported prompt. Freehand expert outlines are recorded point-accurately.
 *
 * Each export carries an unambiguous MODE header so the receiving agent runs the
 * correct process (calibration vs geometry ground-truth vs style-guide update).
 */
import type {
	Annotation,
	LegendItemRow,
	RlFeedbackCursor,
	RlFeedbackSummary,
	TracePoint,
	TrainingFeedback,
} from '../types';
import { centersNear } from './purgedHits';
import { RL_FEEDBACK_TIERS, codesForTier } from './tierProgress';

export type BuildRlOptions = {
	/** ISO timestamp: only include review newer than this (delta mode). */
	since?: string | null;
	/** IDs already exported in a prior prompt (exclude unless forceFull). */
	cursor?: RlFeedbackCursor | null;
	/** When true, include full in-scope history (ignore since/cursor). */
	forceFull?: boolean;
};

/** Single tier or all searchable tiers (1–3). */
export type RlTierScope = number | 'all';

/**
 * Canonical template scales (fraction of legend glyph) that Tier 1/2 rematches
 * must search so off-size copies are not missed after CV revision.
 */
export const CANONICAL_REMATCH_SCALES = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

/** Notes that lean toward style-guide / illustration language rather than ROI/threshold. */
const STYLE_NOTE_RE =
	/\b(style|colour|color|palette|line[\s-]?weight|stroke|linestyle|line[\s-]?style|illustration|render|drawing|drawn|glyph\s+look|art\s*work|iconInterpretation|icon\s+interpretation|different\s+(art|look|style)|not\s+the\s+same\s+style)\b/i;

/** Notes that lean toward missed detections / scale / location (CV path). */
const CV_NOTE_RE =
	/\b(miss(ed)?|not\s+found|wrong\s+(size|scale|location|place)|too\s+(small|large|big)|scale|roi|threshold|nms|false\s+positive|fp|inaccurate|geometry|outline|silhouette)\b/i;

type TierBuckets = {
	tier: number;
	confirms: Annotation[];
	falsePositiveFb: TrainingFeedback[];
	reclassifications: Annotation[];
	freehands: TrainingFeedback[];
	geometry: TrainingFeedback[];
	structured: TrainingFeedback[];
	notes: Array<{ code: string; text: string; source: string }>;
	relatedFp: TrainingFeedback[];
	inScopeAnn: Annotation[];
	inScopeFb: TrainingFeedback[];
};

export type RlModeInfo = {
	/** Machine id pasted at the top of the prompt. */
	mode: string;
	/** Short label for UI. */
	label: string;
	/** Prefer CV vs style-guide when geometry misses are present. */
	missAttribution: 'cv-calibration' | 'style-guide' | 'ambiguous' | 'none';
	/** Reasons the attribution was chosen (for the prompt). */
	attributionReasons: string[];
};

/**
 * Round a native cutaway coordinate for stable prompt serialization.
 * @param n - Pixel coordinate
 */
function roundPx(n: number): number {
	return Math.round(n * 10) / 10;
}

/**
 * Compact closed-loop outline as `(x,y) (x,y) …` with 0.1px precision.
 * @param points - Polyline (may already repeat the first point at the end)
 */
export function formatOutlinePoints(points: TracePoint[]): string {
	return points.map((p) => `(${roundPx(p.x)},${roundPx(p.y)})`).join(' ');
}

/**
 * Concise geometry summary for an expert freehand closed loop.
 * @param points - Outline vertices
 */
export function summarizeOutline(points: TracePoint[]): {
	pointCount: number;
	closed: boolean;
	bbox: { x0: number; y0: number; x1: number; y1: number };
	centroid: { cx: number; cy: number };
	extent: { w: number; h: number };
} {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x0 = Math.min(...xs);
	const x1 = Math.max(...xs);
	const y0 = Math.min(...ys);
	const y1 = Math.max(...ys);
	const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
	const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
	const first = points[0];
	const last = points[points.length - 1];
	const closed =
		points.length >= 3 &&
		Math.hypot(first.x - last.x, first.y - last.y) < 2.5;
	return {
		pointCount: points.length,
		closed,
		bbox: {
			x0: roundPx(x0),
			y0: roundPx(y0),
			x1: roundPx(x1),
			y1: roundPx(y1),
		},
		centroid: { cx: roundPx(cx), cy: roundPx(cy) },
		extent: { w: roundPx(x1 - x0), h: roundPx(y1 - y0) },
	};
}

/**
 * Compact signal flags for one tier's review buckets.
 * @param b - Tier buckets
 */
function tierSignalFlags(b: TierBuckets): {
	empty: boolean;
	hasCalibration: boolean;
	hasGeometry: boolean;
} {
	const hasCalibration =
		b.confirms.length + b.falsePositiveFb.length + b.reclassifications.length > 0;
	const hasGeometry = b.freehands.length > 0;
	const empty =
		!hasCalibration &&
		!hasGeometry &&
		b.geometry.length + b.structured.length + b.notes.length === 0;
	return { empty, hasCalibration, hasGeometry };
}

/**
 * Infer whether freehand / miss signal is primarily CV calibration vs style-guide.
 * Expert need not decide — heuristics mark the preferred path for the agent.
 * @param buckets - Per-tier review buckets
 * @param items - Legend rows (iconInterpretation)
 */
export function inferMissAttribution(
	buckets: TierBuckets[],
	items: LegendItemRow[],
): Pick<RlModeInfo, 'missAttribution' | 'attributionReasons'> {
	const freehands = buckets.flatMap((b) => b.freehands);
	if (freehands.length === 0) {
		return { missAttribution: 'none', attributionReasons: [] };
	}

	const reasons: string[] = [];
	let styleVotes = 0;
	let cvVotes = 0;

	const freehandCodes = new Set(freehands.map((f) => f.code));
	const relatedFpCount = buckets.reduce((n, b) => n + b.relatedFp.length, 0);
	const fpSameCode = buckets
		.flatMap((b) => b.falsePositiveFb)
		.filter((f) => freehandCodes.has(f.code)).length;

	for (const f of freehands) {
		const text = `${f.difficultyNote || ''} ${f.note || ''}`;
		if (STYLE_NOTE_RE.test(text)) {
			styleVotes += 2;
			reasons.push(
				`${f.code}: why/note mentions style/colour/linestyle/iconInterpretation → prefer style-guide update`,
			);
		}
		if (CV_NOTE_RE.test(text)) {
			cvVotes += 2;
			reasons.push(
				`${f.code}: why/note mentions miss/scale/location/geometry → prefer CV threshold/ROI/scale/NMS`,
			);
		}
		const item = items.find((i) => i.code === f.code);
		if (item?.iconInterpretation === '2-discrete' || item?.iconInterpretation === 'multiple-adjacent-as-one') {
			styleVotes += 1;
			reasons.push(
				`${f.code}: iconInterpretation=${item.iconInterpretation} — verify part crops / adjacency policy in profile before one-off detector hacks`,
			);
		}
	}

	if (relatedFpCount + fpSameCode > 0) {
		cvVotes += 2;
		reasons.push(
			`Freehand codes also have FP peaks (${relatedFpCount + fpSameCode}) — wrong peak / scale / ROI more likely than new style`,
		);
	}

	if (freehandCodes.size >= 3) {
		styleVotes += 1;
		reasons.push(
			`${freehandCodes.size} distinct codes freehanded in one delta — broad miss pattern; check style-guide / legend-context for this analysis artwork before narrowing a single slug`,
		);
	}

	if (styleVotes === 0 && cvVotes === 0) {
		cvVotes += 1;
		reasons.push(
			'No explicit style cues in freehand notes — default to CV multi-scale rematch (still template-match); escalate to style-guide only if rematch cannot recover outlines',
		);
	}

	let missAttribution: RlModeInfo['missAttribution'] = 'ambiguous';
	if (styleVotes >= cvVotes + 2) missAttribution = 'style-guide';
	else if (cvVotes >= styleVotes + 1) missAttribution = 'cv-calibration';
	else missAttribution = 'ambiguous';

	return { missAttribution, attributionReasons: reasons };
}

/**
 * Choose an unambiguous MODE id for the exported prompt (Tier 1/2 first-class).
 * @param tierScope - Export scope
 * @param buckets - Per-tier buckets
 * @param items - Legend rows
 */
export function classifyRlMode(
	tierScope: RlTierScope,
	buckets: TierBuckets[],
	items: LegendItemRow[],
): RlModeInfo {
	const { missAttribution, attributionReasons } = inferMissAttribution(buckets, items);
	const nonEmpty = buckets.filter((b) => !tierSignalFlags(b).empty);

	if (nonEmpty.length === 0) {
		const tierBit = tierScope === 'all' ? 'multi' : `tier${tierScope}`;
		return {
			mode: `${tierBit}-empty`,
			label: 'No new review',
			missAttribution: 'none',
			attributionReasons: [],
		};
	}

	if (tierScope === 'all' || nonEmpty.length > 1) {
		const kinds = nonEmpty.map((b) => {
			const f = tierSignalFlags(b);
			if (f.hasGeometry && f.hasCalibration) return `T${b.tier}-mixed`;
			if (f.hasGeometry) return `T${b.tier}-geometry-gt`;
			return `T${b.tier}-calibration`;
		});
		return {
			mode: `multi-tier:${kinds.join('+')}`,
			label: `Multi-tier (${kinds.join(', ')})`,
			missAttribution,
			attributionReasons,
		};
	}

	const b = nonEmpty[0];
	const f = tierSignalFlags(b);
	const tier = b.tier;
	let suffix: 'calibration' | 'geometry-gt' | 'mixed' | 'notes-only' = 'notes-only';
	if (f.hasGeometry && f.hasCalibration) suffix = 'mixed';
	else if (f.hasGeometry) suffix = 'geometry-gt';
	else if (f.hasCalibration) suffix = 'calibration';

	const mode = `tier${tier}-${suffix}`;
	const labels: Record<typeof suffix, string> = {
		calibration: `Tier ${tier} calibration (confirm / FP)`,
		'geometry-gt': `Tier ${tier} geometry ground-truth (freehand)`,
		mixed: `Tier ${tier} mixed (calibration + freehand)`,
		'notes-only': `Tier ${tier} notes / tallies`,
	};

	return {
		mode,
		label: labels[suffix],
		missAttribution: f.hasGeometry ? missAttribution : 'none',
		attributionReasons: f.hasGeometry ? attributionReasons : [],
	};
}

/**
 * Whether a feedback entry is trivial lab noise (test strokes / micro-nudges).
 * @param f - Training feedback row
 */
function isJunkFeedback(f: TrainingFeedback): boolean {
	if (f.kind === 'freehand-classify') return false;
	// Resolved geometry: the matcher still uses the points, but the expert has
	// no outstanding signal here, so it must not resurface in delta prompts.
	if (f.kind === 'freehand-superseded') return true;
	if (f.kind === 'trace') {
		const n = f.points?.length ?? 0;
		return n > 0 && n < 8;
	}
	if (f.kind === 'relocate' || f.kind === 'resize') {
		const from = f.from;
		const to = f.to;
		if (!from || !to) return true;
		const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy);
		// Micro test nudges (e.g. 100,100 → 110,105) are not expert signal.
		if (dist < 18) return true;
		if (from.cx <= 120 && from.cy <= 120 && to.cx <= 130 && to.cy <= 130) return true;
	}
	return false;
}

/**
 * Whether an annotation should appear in this delta prompt.
 * @param a - Annotation
 * @param opts - Delta options
 * @param consumed - Previously exported annotation ids
 */
function annotationIsNew(
	a: Annotation,
	opts: BuildRlOptions,
	consumed: Set<string>,
): boolean {
	if (opts.forceFull) return true;
	if (a.id && consumed.has(a.id)) return false;
	if (opts.since && a.updatedAt) {
		return Date.parse(a.updatedAt) > Date.parse(opts.since);
	}
	if (opts.since) return false;
	return true;
}

/**
 * Whether a feedback row should appear in this delta prompt.
 * @param f - Feedback
 * @param opts - Delta options
 * @param consumed - Previously exported feedback ids
 */
function feedbackIsNew(
	f: TrainingFeedback,
	opts: BuildRlOptions,
	consumed: Set<string>,
): boolean {
	if (opts.forceFull) return !isJunkFeedback(f);
	if (consumed.has(f.id)) return false;
	if (isJunkFeedback(f)) return false;
	// Expert freehand is always included until the cursor consumes it.
	if (f.kind === 'freehand-classify') return true;
	if (opts.since && f.createdAt) {
		return Date.parse(f.createdAt) > Date.parse(opts.since);
	}
	if (opts.since) return false;
	return true;
}

/**
 * Resolve which tier numbers a prompt should cover.
 * @param tierScope - One tier or all searchable tiers
 */
export function resolveRlTier(tierScope: RlTierScope): number[] {
	if (tierScope === 'all') return [...RL_FEEDBACK_TIERS];
	return [tierScope];
}

/**
 * Collect confirm / FP / freehand / geometry buckets for one tier's code set.
 * @param tier - Observability tier number
 * @param scope - Legend codes in this tier
 * @param items - Legend rows
 * @param annotations - Hit annotations
 * @param feedback - All training feedback
 * @param deltaOpts - Delta filter options
 * @param consumedAnn - Already-exported annotation ids
 * @param consumedFb - Already-exported feedback ids
 */
function collectTierBuckets(
	tier: number,
	scope: Set<string>,
	items: LegendItemRow[],
	annotations: Annotation[],
	feedback: TrainingFeedback[],
	deltaOpts: BuildRlOptions,
	consumedAnn: Set<string>,
	consumedFb: Set<string>,
): TierBuckets {
	const inScopeAnn = annotations.filter(
		(a) =>
			a.label !== 'false-positive' &&
			(scope.has(a.code) || (a.reassignedCode && scope.has(a.reassignedCode))) &&
			annotationIsNew(a, deltaOpts, consumedAnn),
	);
	const inScopeFb = feedback.filter(
		(f) => scope.has(f.code) && feedbackIsNew(f, deltaOpts, consumedFb),
	);

	const confirms = inScopeAnn.filter((a) => a.label === 'confirmed');
	const falsePositiveFb = inScopeFb.filter((f) => f.kind === 'false-positive');
	const reclassifications = inScopeAnn.filter((a) => a.label === 'reassigned');
	const freehands = inScopeFb.filter((f) => f.kind === 'freehand-classify');
	const geometry = inScopeFb.filter(
		(f) =>
			f.kind === 'relocate' ||
			f.kind === 'resize' ||
			(f.kind === 'trace' && (f.points?.length || 0) >= 8),
	);
	const structured = inScopeFb.filter((f) => {
		if (
			f.kind !== 'correct-location' &&
			f.kind !== 'wrong-location' &&
			f.kind !== 'pending-miss'
		) {
			return false;
		}
		if (f.kind === 'correct-location' && !f.note?.trim()) {
			const echoesConfirm = confirms.some(
				(a) =>
					a.code === f.code &&
					f.from &&
					centersNear(a.cx, a.cy, f.from.cx, f.from.cy ?? 0, 2),
			);
			if (echoesConfirm) return false;
		}
		return true;
	});

	const notes: Array<{ code: string; text: string; source: string }> = [];
	for (const a of inScopeAnn) {
		if (a.note?.trim()) {
			notes.push({ code: a.code, text: a.note.trim(), source: `annotation:${a.label}` });
		}
	}
	for (const f of inScopeFb) {
		if (f.kind === 'freehand-classify') continue;
		if (f.kind === 'false-positive') continue;
		if (f.kind === 'deleted' || f.kind === 'deleted-code') continue;
		if (f.note?.trim()) {
			notes.push({ code: f.code, text: f.note.trim(), source: `feedback:${f.kind}` });
		}
	}

	const relatedFp: TrainingFeedback[] = [];
	if (freehands.length > 0 && !deltaOpts.forceFull) {
		const freehandCodes = new Set(freehands.map((f) => f.code));
		for (const f of feedback) {
			if (f.kind !== 'false-positive') continue;
			if (!freehandCodes.has(f.code)) continue;
			if (falsePositiveFb.includes(f)) continue;
			relatedFp.push(f);
		}
	}

	return {
		tier,
		confirms,
		falsePositiveFb,
		reclassifications,
		freehands,
		geometry,
		structured,
		notes,
		relatedFp,
		inScopeAnn,
		inScopeFb,
	};
}

/**
 * Whether a tier bucket has any exportable review signal.
 * @param b - Tier buckets
 */
function tierBucketEmpty(b: TierBuckets): boolean {
	return (
		b.confirms.length +
			b.falsePositiveFb.length +
			b.reclassifications.length +
			b.freehands.length +
			b.geometry.length +
			b.structured.length +
			b.notes.length ===
		0
	);
}

/**
 * Append markdown sections for one tier's review buckets.
 * @param lines - Markdown lines to mutate
 * @param b - Tier buckets
 * @param nameOf - Code → display name
 * @param headingPrefix - Markdown heading level prefix (e.g. `##` or `###`)
 * @param defaultTier - Fallback tier number for freehand rows
 * @param forceFull - Whether this export is full history (not delta)
 */
function appendBucketSections(
	lines: string[],
	b: TierBuckets,
	nameOf: (code: string) => string,
	headingPrefix: string,
	defaultTier: number,
	forceFull: boolean,
): void {
	if (tierBucketEmpty(b)) {
		lines.push(
			`${headingPrefix} No new review`,
			forceFull
				? `- No review recorded for Tier ${b.tier}.`
				: `- Nothing new for Tier ${b.tier} since the last prompt.`,
			``,
		);
		return;
	}

	if (b.confirms.length > 0) {
		lines.push(`${headingPrefix} New confirms (${b.confirms.length})`);
		for (const a of b.confirms) {
			lines.push(
				`- ${a.code} ${nameOf(a.code)} @ (${roundPx(a.cx)}, ${roundPx(a.cy)})` +
					(a.locationStatus ? ` · ${a.locationStatus}` : '') +
					(a.note ? ` — ${a.note}` : ''),
			);
		}
		lines.push(``);
	}

	if (b.falsePositiveFb.length > 0) {
		lines.push(`${headingPrefix} New false positives (${b.falsePositiveFb.length})`);
		for (const f of b.falsePositiveFb) {
			const cx = f.from?.cx ?? 0;
			const cy = f.from?.cy ?? 0;
			lines.push(
				`- ${f.code} ${nameOf(f.code)} @ (${roundPx(cx)}, ${roundPx(cy)})` +
					(f.note ? ` — ${f.note}` : ''),
			);
		}
		lines.push(``);
	}

	if (b.reclassifications.length > 0) {
		lines.push(`${headingPrefix} New reclassifications (${b.reclassifications.length})`);
		for (const a of b.reclassifications) {
			lines.push(
				`- ${a.code} → ${a.reassignedCode || '?'} @ (${roundPx(a.cx)}, ${roundPx(a.cy)})` +
					(a.note ? ` — ${a.note}` : ''),
			);
		}
		lines.push(``);
	}

	if (b.freehands.length > 0) {
		lines.push(`${headingPrefix} Expert freehand classifications (${b.freehands.length})`);
		for (const f of b.freehands) {
			const pts = f.points || [];
			const geo = pts.length ? summarizeOutline(pts) : null;
			lines.push(
				`${headingPrefix}# ${f.code} ${f.name || nameOf(f.code)} · freehand-classify · tier ${f.tier ?? defaultTier} · score ${(f.score ?? 1).toFixed(2)}`,
			);
			const pathways =
				Array.isArray(f.assignedPathways) && f.assignedPathways.length > 0
					? f.assignedPathways
					: f.assignedPathway
						? [f.assignedPathway]
						: [];
			if (pathways.length > 0) {
				lines.push(`- pathways: ${pathways.join(', ')}`);
			}
			if (f.difficultyNote?.trim()) {
				lines.push(`- why: ${f.difficultyNote.trim()}`);
			}
			if (f.note?.trim()) {
				lines.push(`- note: ${f.note.trim()}`);
			}
			if (geo) {
				lines.push(
					`- summary: ${geo.pointCount} verts` +
						`${geo.closed ? ', closed' : ', open'}` +
						`; bbox (${geo.bbox.x0},${geo.bbox.y0})–(${geo.bbox.x1},${geo.bbox.y1})` +
						`; extent ${geo.extent.w}×${geo.extent.h}` +
						`; centroid (${geo.centroid.cx},${geo.centroid.cy})`,
				);
				lines.push(`- outline (native px): ${formatOutlinePoints(pts)}`);
			} else {
				lines.push(`- outline: (missing points)`);
			}
			lines.push(``);
		}
	}

	if (b.geometry.length > 0) {
		lines.push(`${headingPrefix} Other geometry (${b.geometry.length})`);
		for (const f of b.geometry) {
			const from = f.from
				? `(${roundPx(f.from.cx)}, ${roundPx(f.from.cy)})`
				: '—';
			const to = f.to
				? `(${roundPx(f.to.cx)}, ${roundPx(f.to.cy)})`
				: f.points
					? `${f.points.length} pts`
					: '—';
			lines.push(`- ${f.kind} ${f.code}: ${from} → ${to}` + (f.note ? ` — ${f.note}` : ''));
		}
		lines.push(``);
	}

	if (b.structured.length > 0) {
		lines.push(`${headingPrefix} Location tallies (${b.structured.length})`);
		for (const f of b.structured) {
			lines.push(`- ${f.kind} ${f.code}` + (f.note ? ` — ${f.note}` : ''));
		}
		lines.push(``);
	}

	if (b.notes.length > 0) {
		lines.push(`${headingPrefix} Notes (${b.notes.length})`);
		for (const n of b.notes) {
			lines.push(`- [${n.source}] ${n.code}: ${n.text}`);
		}
		lines.push(``);
	}

	if (b.relatedFp.length > 0) {
		lines.push(`${headingPrefix} Related prior FPs (codes in this freehand only)`);
		for (const f of b.relatedFp) {
			const cx = f.from?.cx ?? 0;
			const cy = f.from?.cy ?? 0;
			lines.push(
				`- ${f.code} ${nameOf(f.code)} was FP @ (${roundPx(cx)}, ${roundPx(cy)}) — use expert freehand above as ground truth`,
			);
		}
		lines.push(``);
	}
}

/**
 * Paths the receiving agent must load for MODE process (not repeated in every paste).
 */
export const RL_PROMPT_INTERNAL_REFS = [
	'.cursor/rules/lung-legend-rl-feedback.mdc',
	'.cursor/agents/lung-legend-rl-feedback.md',
	'.cursor/skills/lung-legend-template-match/SKILL.md',
	'tools/lung-legend-lab/RL-FEEDBACK-STACK.md',
] as const;

/**
 * Collect delta review for one tier or all searchable tiers and render a prompt.
 * Freehand expert loops include full outline coordinates plus a short summary.
 *
 * Boilerplate MODE/process/rematch instructions live in project rules/agents —
 * the paste carries only the machine header, instance-specific rationale, and
 * review delta so multi-tier / multi-iteration prompts stay non-redundant.
 *
 * @param tierScope - Active verification tier, or `'all'` for tiers 1–3
 * @param items - Legend rows (for names / tiers)
 * @param annotations - Hit annotations
 * @param feedback - Geometry + freehand + mirrored review feedback
 * @param opts - Delta / cursor options
 */
export function buildRlFeedbackSummary(
	tierScope: RlTierScope,
	items: LegendItemRow[],
	annotations: Annotation[],
	feedback: TrainingFeedback[],
	opts: BuildRlOptions = {},
): RlFeedbackSummary {
	const tiers = resolveRlTier(tierScope);
	const allTiers = tierScope === 'all';
	const nameOf = (code: string) => items.find((i) => i.code === code)?.name || code;
	const consumedAnn = new Set(opts.cursor?.annotationIds || []);
	const consumedFb = new Set(opts.cursor?.feedbackIds || []);

	const since = opts.since ?? opts.cursor?.consumedAt ?? null;
	const deltaOpts: BuildRlOptions = { ...opts, since };
	const isDelta = !opts.forceFull;

	const buckets = tiers.map((tier) =>
		collectTierBuckets(
			tier,
			codesForTier(items, tier),
			items,
			annotations,
			feedback,
			deltaOpts,
			consumedAnn,
			consumedFb,
		),
	);

	const modeInfo = classifyRlMode(tierScope, buckets, items);

	const lines: string[] = [
		`MODE: ${modeInfo.mode}`,
		`MODE_LABEL: ${modeInfo.label}`,
		`MISS_ATTRIBUTION: ${modeInfo.missAttribution}`,
		`REF: ${RL_PROMPT_INTERNAL_REFS.join(' · ')}`,
		``,
		allTiers
			? `# RL delta · all tiers` + (isDelta ? '' : ' · full history')
			: `# RL delta · Tier ${tiers[0]}` + (isDelta ? '' : ' · full history'),
		isDelta
			? `New review only` + (since ? ` since ${since}` : ' (this session)') + `.`
			: `Full in-scope history.`,
		`Execute MODE using REF (do not restate stack rules). End with the mandatory RL pass summary.`,
		``,
	];

	if (modeInfo.attributionReasons.length > 0) {
		lines.push(`## Miss attribution (this delta)`);
		for (const r of modeInfo.attributionReasons) {
			lines.push(`- ${r}`);
		}
		lines.push(``);
	}

	const allEmpty = buckets.every(tierBucketEmpty);

	if (allEmpty) {
		lines.push(
			`## No new review`,
			`- Nothing new` +
				(allTiers ? ' for any searchable tier' : ` for Tier ${tiers[0]}`) +
				` since the last prompt.`,
			``,
		);
	} else if (allTiers) {
		for (const b of buckets) {
			if (tierBucketEmpty(b)) continue;
			lines.push(`## Tier ${b.tier}`);
			lines.push(``);
			appendBucketSections(lines, b, nameOf, '###', b.tier, Boolean(opts.forceFull));
		}
	} else {
		appendBucketSections(lines, buckets[0], nameOf, '##', tiers[0], Boolean(opts.forceFull));
	}

	const promptMarkdown = lines.join('\n');

	const confirms = buckets.flatMap((b) => b.confirms);
	const falsePositiveFb = buckets.flatMap((b) => b.falsePositiveFb);
	const reclassifications = buckets.flatMap((b) => b.reclassifications);
	const freehands = buckets.flatMap((b) => b.freehands);
	const geometry = buckets.flatMap((b) => b.geometry);
	const structured = buckets.flatMap((b) => b.structured);
	const notes = buckets.flatMap((b) => b.notes);
	const inScopeAnn = buckets.flatMap((b) => b.inScopeAnn);
	const inScopeFb = buckets.flatMap((b) => b.inScopeFb);

	const touchedCodes = new Set<string>([
		...confirms.map((a) => a.code),
		...falsePositiveFb.map((f) => f.code),
		...reclassifications.map((a) => a.code),
		...freehands.map((f) => f.code),
		...geometry.map((f) => f.code),
	]);

	const includedAnnotationIds = inScopeAnn.map((a) => a.id).filter(Boolean) as string[];
	const includedFeedbackIds = [
		...falsePositiveFb,
		...freehands,
		...geometry,
		...structured,
		...inScopeFb,
	]
		.map((f) => f.id)
		.filter(Boolean);

	return {
		tierToTest: allTiers ? 'all' : tiers[0],
		mode: modeInfo.mode,
		modeLabel: modeInfo.label,
		missAttribution: modeInfo.missAttribution,
		generatedAt: new Date().toISOString(),
		isDelta,
		since: since || null,
		counts: {
			confirms: confirms.length,
			falsePositives: falsePositiveFb.length,
			reclassifications: reclassifications.length,
			geometry: geometry.length + freehands.length,
			structured: structured.length,
			notes: notes.length,
			freehand: freehands.length,
		},
		confirms: confirms.map((a) => ({
			code: a.code,
			cx: a.cx,
			cy: a.cy,
			locationStatus: a.locationStatus ?? null,
			note: a.note || '',
		})),
		falsePositives: falsePositiveFb.map((f) => ({
			code: f.code,
			cx: f.from?.cx ?? 0,
			cy: f.from?.cy ?? 0,
			note: f.note || '',
		})),
		reclassifications: reclassifications.map((a) => ({
			code: a.code,
			reassignedCode: a.reassignedCode || null,
			cx: a.cx,
			cy: a.cy,
			note: a.note || '',
		})),
		geometry: [...freehands, ...geometry].map((f) => ({
			id: f.id,
			code: f.code,
			kind: f.kind,
			from: f.from ?? null,
			to: f.to ?? null,
			pointCount: f.points?.length ?? 0,
			points: f.kind === 'freehand-classify' ? f.points || null : null,
			name: f.name ?? null,
			tier: f.tier ?? null,
			difficultyNote: f.difficultyNote ?? null,
			assignedPathways:
				f.kind === 'freehand-classify'
					? f.assignedPathways?.length
						? f.assignedPathways
						: f.assignedPathway
							? [f.assignedPathway]
							: []
					: undefined,
			note: f.note || '',
		})),
		notes,
		includedAnnotationIds,
		includedFeedbackIds: [...new Set(includedFeedbackIds)],
		touchedCodes: [...touchedCodes],
		promptMarkdown,
	};
}

/**
 * Merge newly exported ids into the durable RL feedback cursor.
 * @param prev - Existing cursor, if any
 * @param summary - Just-exported summary
 */
export function advanceRlCursor(
	prev: RlFeedbackCursor | null | undefined,
	summary: RlFeedbackSummary,
): RlFeedbackCursor {
	return {
		consumedAt: summary.generatedAt,
		annotationIds: [
			...new Set([...(prev?.annotationIds || []), ...summary.includedAnnotationIds]),
		],
		feedbackIds: [
			...new Set([...(prev?.feedbackIds || []), ...summary.includedFeedbackIds]),
		],
	};
}
