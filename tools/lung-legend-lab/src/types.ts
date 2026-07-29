/** Shared TypeScript types for the maintainer lung legend lab UI. */

export type IconInterpretation = '1-discrete' | '2-discrete' | 'multiple-adjacent-as-one';

export type AnnotationLabel = 'confirmed' | 'false-positive' | 'reassigned';

/** Structured location tally for a legend item / hit (owner review). */
export type LocationTallyKind = 'correct-location' | 'wrong-location' | 'pending-miss';

/** Rolled-up per-item verification status used in Pipeline tallies. */
export type ItemTallyStatus = 'correct-location' | 'wrong-location' | 'pending';

/** Cutaway stage edit mode: select matches or freehand-classify a closed region. */
export type EditMode = 'select' | 'freehand-classify';

/** Persisted review + freehand / geometry teaching feedback kinds. */
export type TrainingFeedbackKind =
	| 'relocate'
	| 'resize'
	| 'trace'
	| 'freehand-classify'
	/**
	 * A freehand outline that a compatible algorithm hit has taken over. Kept
	 * (points and all) as durable geometry ground truth for the template
	 * matcher, but invisible to review UI so freehand + hit never both show.
	 */
	| 'freehand-superseded'
	| 'false-positive'
	| 'deleted'
	/** Suppress a code-level Database View placeholder (pending / no-hit row). */
	| 'deleted-code'
	| 'confirmed'
	| 'reassigned'
	| 'correct-location'
	| 'wrong-location'
	| 'pending-miss';
export type BoxGeom = {
	cx: number;
	cy: number;
	w?: number;
	h?: number;
};

export type TracePoint = { x: number; y: number };

export type TrainingFeedback = {
	id: string;
	code: string;
	kind: TrainingFeedbackKind;
	from?: BoxGeom | null;
	to?: BoxGeom | null;
	points?: TracePoint[] | null;
	/** Display / new label name for freehand classification. */
	name?: string | null;
	/** Observability tier / difficulty (0–3) for freehand classification. */
	tier?: number | null;
	/** Why this tier/difficulty was chosen — training intelligence. */
	difficultyNote?: string | null;
	/**
	 * Match-style confidence for freehand traces (manual expert = 1.0 / 100%).
	 */
	score?: number | null;
	/**
	 * Image pathway layers this freehand belongs to (base / cannabis / …),
	 * same semantics as legend-item `assignedPathways`.
	 */
	assignedPathways?: string[];
	/** @deprecated Prefer assignedPathways. */
	assignedPathway?: string | null;
	/**
	 * Persisted legend-style icon for freehand rows (PNG under workspace/freehand-icons).
	 * Served as `/api/assets/freehand-icon/{id}`.
	 */
	iconRel?: string | null;
	note?: string;
	createdAt: string;
};

/** Top-level refine navigation: Image View, Database View, Legend View. */
export type RefineScreen = 'image' | 'database' | 'legend';

/** Filterable review status for the Database & Classification Pipeline table. */
export type DatabaseRowStatus =
	| 'confirmed'
	| 'false-positive'
	| 'reassigned'
	| 'unreviewed'
	| 'pending'
	| 'freehand';

export type FindingInstance = {
	cx: number | null;
	cy: number | null;
	score: number | null;
	scale?: number;
	mode?: string;
	w?: number;
	h?: number;
	runId?: string;
	timestamp?: string;
};

export type LegendItemRow = {
	code: string;
	name: string;
	location: string;
	supports: string;
	glyph_path: string | null;
	row_path: string | null;
	tier: number | null;
	subTier: string | null;
	iconInterpretation: IconInterpretation | string;
	searchable: boolean;
	group: string | null;
	slug: string | null;
	note: string | null;
	/**
	 * Image pathway layers this legend item belongs to (one or more).
	 * These are exposure composites (base / cannabis / …), not legend codes.
	 */
	assignedPathways: string[];
	/** @deprecated Prefer assignedPathways — kept for older snapshots. */
	assignedPathway?: string | null;
	status: 'found' | 'missed' | 'skipped' | null;
	instanceCount: number;
	bestScore: number | null;
	minScore?: number | null;
	firstFoundAt: string | null;
	cumulativeFindCount: number;
	instances: FindingInstance[];
};

export type TierSummary = {
	tier: number;
	label: string;
	summary: string;
	focus: boolean;
};

export type Criteria = {
	guidelines?: string;
	tiers?: TierSummary[];
	subTierHelp?: Record<string, string>;
	iconInterpretationHelp?: Record<string, string>;
};

export type TierStats = {
	expected?: number;
	found?: number;
	missed?: number;
	skipped?: number;
	instanceTotal?: number;
	meanBestScore?: number | null;
};

export type FindingsDb = {
	meta?: {
		updatedAt?: string;
		runId?: string;
		phase?: string;
		focusTier?: number[];
		nextTier?: number;
	};
	criteria?: Criteria;
	stats?: Record<string, TierStats | number | null | undefined>;
	items?: Record<string, LegendItemRow & { instances: FindingInstance[] }>;
	runs?: Array<{
		runId: string;
		timestamp: string;
		source?: string;
		tier1_mean_score?: number | null;
		byCode?: Record<string, { status: string; instanceCount: number; bestScore: number | null }>;
	}>;
};

export type Annotation = {
	id: string;
	code: string;
	cx: number;
	cy: number;
	score?: number | null;
	label: AnnotationLabel;
	reassignedCode?: string | null;
	/** Structured location tally; defaults inferred from label when omitted. */
	locationStatus?: LocationTallyKind | null;
	note?: string;
	updatedAt?: string;
};

/** Graduation decision for a tier in the Pipeline UI. */
export type TierGraduation = {
	good: boolean;
	correctOk: boolean;
	fpOk: boolean;
	thresholds: { minCorrectPct: number; maxFpPct: number };
};

/** Per-code status row inside a tier progress snapshot. */
export type TierItemStatusRow = {
	code: string;
	name: string;
	status: ItemTallyStatus;
	hasHits: boolean;
};

/** Computed progress / tallies for one observability tier. */
export type TierProgressSnapshot = {
	tier: number;
	label: string;
	itemStatuses: TierItemStatusRow[];
	correctCount: number;
	wrongCount: number;
	pendingCount: number;
	expected: number;
	correctnessPct: number;
	fpCount: number;
	reviewedCount: number;
	fpRate: number;
	graduation: TierGraduation;
	detectedInstances: number;
};

/** Cursor of already-exported review ids so the next prompt is a delta. */
export type RlFeedbackCursor = {
	consumedAt: string;
	annotationIds: string[];
	feedbackIds: string[];
};

/** RL feedback package shown in Generate Feedback Prompt (delta by default). */
export type RlFeedbackSummary = {
	/** Active tier, or `'all'` when the export covers searchable tiers 1–3. */
	tierToTest: number | 'all';
	/**
	 * Unambiguous agent process id, e.g. `tier1-calibration`, `tier1-geometry-gt`,
	 * `tier2-mixed`, `tier1-empty`.
	 */
	mode: string;
	/** Human-readable mode title for the modal. */
	modeLabel: string;
	/** Prefer CV param revision vs style-guide update when freehand/misses present. */
	missAttribution: 'cv-calibration' | 'style-guide' | 'ambiguous' | 'none';
	generatedAt: string;
	isDelta: boolean;
	since: string | null;
	counts: {
		confirms: number;
		falsePositives: number;
		reclassifications: number;
		geometry: number;
		structured: number;
		notes: number;
		freehand: number;
	};
	confirms: Array<{
		code: string;
		cx: number;
		cy: number;
		locationStatus: LocationTallyKind | null;
		note: string;
	}>;
	falsePositives: Array<{ code: string; cx: number; cy: number; note: string }>;
	reclassifications: Array<{
		code: string;
		reassignedCode: string | null;
		cx: number;
		cy: number;
		note: string;
	}>;
	geometry: Array<{
		id: string;
		code: string;
		kind: TrainingFeedbackKind;
		from: BoxGeom | null;
		to: BoxGeom | null;
		pointCount: number;
		points?: TracePoint[] | null;
		name?: string | null;
		tier?: number | null;
		difficultyNote?: string | null;
		note: string;
	}>;
	notes: Array<{ code: string; text: string; source: string }>;
	includedAnnotationIds: string[];
	includedFeedbackIds: string[];
	touchedCodes: string[];
	promptMarkdown: string;
};

export type JobState = {
	id: string;
	kind: string;
	status: 'queued' | 'running' | 'succeeded' | 'failed';
	exitCode: number | null;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	meta: Record<string, unknown>;
	log: string[];
	logTail: string[];
};

export type AnalysisSummary = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	phase: 'classify' | 'refine';
	usingDefaults: boolean;
	notes: string | null;
	/** Bound style-guide profile id (kebab catalog id). */
	styleGuideProfileId?: string | null;
	/** Highest Tier to Test unlocked for this analysis (1–3). Always set by summarizeAnalysis. */
	maxUnlockedTier?: number;
	/** Current Tier to Test (snapshotted in meta). Always set by summarizeAnalysis. */
	tierToTest?: number;
	/** Refine sub-view for resume. */
	refineScreen?: 'image' | 'database' | 'legend';
	/** Last top-level screen. */
	screen?: 'home' | 'classify' | 'refine';
	hasCutaway: boolean;
	hasLegend: boolean;
	hasClassification: boolean;
	hasFindings: boolean;
	hasStyleGuideSnapshot?: boolean;
	hasRlFeedback?: boolean;
	hasTrainingFeedback?: boolean;
	tier1Found: number | null;
	tier1Expected: number | null;
	tier1Instances: number | null;
};

/** Compact catalog entry for the style-guide picker. */
export type StyleGuideProfileSummary = {
	id: string;
	title: string;
	version: string | null;
	summary: string;
	uiBrief?: {
		paletteSwatches?: string[];
		headline?: string;
		namingExamples?: string[];
	} | null;
	jsonRel?: string | null;
	markdownRel?: string | null;
};

/** Active style-guide profile brief shipped with /api/state (no full markdown). */
export type StyleGuideProfileBrief = {
	id: string;
	title: string;
	version: string;
	summary: string;
	visualLanguage?: {
		aesthetic?: string[];
		palette?: {
			backgrounds?: string[];
			outlines?: string[];
			notes?: string;
		};
		typography?: string;
		lineWeights?: string;
		composition?: string;
		forbiddenStyles?: string[];
	} | null;
	illustrationFramework?: string[];
	ontology?: {
		tissues?: Array<{ id: string; label: string; legendCode?: string }>;
		cells?: Array<{ id: string; label: string; legendCode?: string }>;
		pathways?: Array<{ id: string; label: string; legendCode?: string }>;
		diseaseProcesses?: Array<{ id: string; label: string; legendCode?: string }>;
	} | null;
	/**
	 * Image / exposure pathway layers (base, cannabis, cigarette smoke, …).
	 * Distinct from legend items (A1–B9) and from kebab asset slugs.
	 */
	imagePathways?: Array<{ id: string; label: string }> | null;
	layerNaming?: {
		convention?: string;
		groupRules?: Record<string, string>;
		stableIds?: Array<{
			id: string;
			legendCode?: string;
			group?: string;
			frameworkAlias?: string;
			/** Image pathway layer ids from profile `imagePathways` (from legend supports). */
			pathways?: string[];
		}>;
		assetPattern?: string;
	} | null;
	siteCompatibility?: {
		summary?: string;
		constraints?: string[];
	} | null;
	agentInstructions?: string[];
	imageGenPromptTemplates?: {
		status?: string;
		reason?: string;
	} | null;
	uiBrief?: StyleGuideProfileSummary['uiBrief'];
	markdownRel?: string | null;
	jsonRel?: string | null;
};

export type LabState = {
	ok: boolean;
	session: {
		cutawayPath: string;
		legendPath: string;
		usingDefaults: boolean;
		cutawayRel: string;
		legendRel: string;
		cutawayExists: boolean;
		legendExists: boolean;
		updatedAt: string;
		analysisId: string | null;
		analysisName: string | null;
		phase: 'classify' | 'refine';
		screen: 'home' | 'classify' | 'refine';
		/** Active style-guide profile id for this analysis. */
		styleGuideProfileId?: string | null;
		/** Highest Tier to Test the owner may select (gated progression). */
		maxUnlockedTier?: number;
		/** Last Tier to Test selection (persisted per analysis). */
		tierToTest?: number;
		/** Refine sub-view (image / database / legend). */
		refineScreen?: 'image' | 'database' | 'legend';
	};
	analyses: AnalysisSummary[];
	/** Catalog of available style-guide profiles. */
	styleGuideProfiles: StyleGuideProfileSummary[];
	/** Active profile brief (visual language, ontology, naming). */
	styleGuideProfile: StyleGuideProfileBrief | null;
	defaults: { cutaway: string; legend: string };
	enums: {
		subTiers: string[];
		iconInterpretations: string[];
		pathways: string[];
	};
	outlineSlugs: string[];
	extract: { items?: Array<Record<string, unknown>>; guidelines?: string } | null;
	classification: {
		classifications?: Record<string, Record<string, unknown>>;
		subTierHelp?: Record<string, string>;
		iconInterpretationHelp?: Record<string, string>;
		guidelines?: string;
	} | null;
	findings: FindingsDb | null;
	matchReport: { layers?: Record<string, unknown>; tier1_mean_score?: number } | null;
	annotations: { annotations: Annotation[] };
	trainingFeedback: { feedback: TrainingFeedback[] };
	/** Already-exported review ids for delta feedback prompts. */
	rlCursor: RlFeedbackCursor | null;
	paths: Record<string, string>;
};
