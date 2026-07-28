/** Shared TypeScript types for the maintainer lung legend lab UI. */

export type IconInterpretation = '1-discrete' | '2-discrete' | 'multiple-adjacent-as-one';

export type AnnotationLabel = 'confirmed' | 'false-positive' | 'reassigned';

/** Geometry / review edit mode for the cutaway stage. */
export type EditMode = 'select' | 'relocate' | 'resize' | 'trace';

/** Persisted tier-1 review + tier-2 geometry teaching feedback. */
export type TrainingFeedbackKind =
	| 'relocate'
	| 'resize'
	| 'trace'
	| 'false-positive'
	| 'confirmed'
	| 'reassigned';

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
	note?: string;
	createdAt: string;
};

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
	note?: string;
	updatedAt?: string;
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
	hasCutaway: boolean;
	hasLegend: boolean;
	hasClassification: boolean;
	hasFindings: boolean;
	tier1Found: number | null;
	tier1Expected: number | null;
	tier1Instances: number | null;
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
	};
	analyses: AnalysisSummary[];
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
	paths: Record<string, string>;
};
