/**
 * API helpers for saved analyses + session screens.
 */
import type {
	Annotation,
	JobState,
	LabState,
	LegendItemRow,
	StyleGuideProfileBrief,
	StyleGuideProfileSummary,
	TrainingFeedback,
	TrainingFeedbackKind,
	BoxGeom,
	TracePoint,
} from './types';

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(path);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${res.status} ${path}: ${text}`);
	}
	return res.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
	const res = await fetch(path, {
		method,
		headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${res.status} ${path}: ${text}`);
	}
	return res.json() as Promise<T>;
}

/** Load bootstrap state (assets, findings, classification, analyses). */
export function fetchState(): Promise<LabState> {
	return getJson<LabState>('/api/state');
}

/** Load merged legend items for the classify panel. */
export function fetchItems(): Promise<{
	items: LegendItemRow[];
	criteria: unknown;
	stats: unknown;
}> {
	return getJson('/api/items');
}

export function fetchJob(id: string): Promise<JobState> {
	return getJson<JobState>(`/api/jobs/${id}`);
}

export function startExtract(): Promise<JobState> {
	return sendJson<JobState>('/api/extract', 'POST');
}

export function startMatch(body?: {
	tierToTest?: number;
	rlSummary?: unknown;
}): Promise<JobState> {
	return sendJson<JobState>('/api/match', 'POST', body || {});
}

/**
 * Persist RL feedback prompt + delta cursor (no matcher run).
 * @param payload - Prompt markdown, summary, and advanced cursor
 */
export function saveRlFeedback(payload: {
	tierToTest: number | 'all';
	promptMarkdown: string;
	summary: unknown;
	cursor?: unknown;
}): Promise<{ ok: boolean; cursor: unknown; paths: Record<string, string> }> {
	return sendJson('/api/rl-feedback', 'POST', payload);
}

export function startFindingsRefresh(): Promise<JobState> {
	return sendJson<JobState>('/api/findings/refresh', 'POST');
}

export function resetDefaults(): Promise<{ ok: boolean }> {
	return sendJson('/api/reset-defaults', 'POST');
}

export async function uploadAssets(cutaway?: File | null, legend?: File | null): Promise<unknown> {
	const form = new FormData();
	if (cutaway) form.append('cutaway', cutaway);
	if (legend) form.append('legend', legend);
	const res = await fetch('/api/upload', { method: 'POST', body: form });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

export function saveClassification(
	code: string,
	patch: Record<string, unknown>,
): Promise<{ ok: boolean }> {
	return sendJson(`/api/classification/${code}`, 'PUT', patch);
}

export function saveAllClassifications(
	classifications: Record<string, Record<string, unknown>>,
): Promise<{ ok: boolean }> {
	return sendJson('/api/classification', 'PUT', { classifications });
}

/**
 * Persist a tier-1 Confirm / FP / reclassify annotation for a match center.
 * @param annotation - Annotation payload keyed by code + center
 */
export function saveAnnotation(
	annotation: Partial<Annotation> & {
		code: string;
		cx: number;
		cy: number;
		label: Annotation['label'];
		locationStatus?: Annotation['locationStatus'];
	},
): Promise<{
	ok: boolean;
	annotations: { annotations: Annotation[] };
	trainingFeedback?: { feedback: TrainingFeedback[] };
	purged?: boolean;
}> {
	return sendJson('/api/annotations', 'PUT', annotation);
}

/**
 * Permanently remove a Database View row from active datasets (match hit or freehand).
 * Match deletes scrub annotations / related feedback, drop the findings instance,
 * and persist a `deleted` marker so rematch reload stays suppressed.
 * Pending / no-hit placeholders use `deleteCode` → `deleted-code` marker.
 *
 * @param payload - Row identity (match center, freehand feedback id, or whole code)
 */
export function deleteDatabaseRow(payload: {
	kind: 'match' | 'freehand';
	code?: string;
	cx?: number | null;
	cy?: number | null;
	/** When true, purge a pending/code-level placeholder (no hit center). */
	deleteCode?: boolean;
	feedbackId?: string | null;
	note?: string;
}): Promise<{
	ok: boolean;
	kind: 'match' | 'freehand';
	code: string | null;
	findingsRemoved: boolean;
	freehandRemoved: boolean;
	annotations: { annotations: Annotation[] };
	trainingFeedback: { feedback: TrainingFeedback[] };
}> {
	return sendJson('/api/database-row/delete', 'POST', payload);
}

/**
 * Append a geometry, freehand-classify, or mirrored review feedback entry.
 * @param payload - Feedback kind, code, optional geometry + freehand fields
 */
export function saveTrainingFeedback(payload: {
	code: string;
	kind: TrainingFeedbackKind;
	from?: BoxGeom | null;
	to?: BoxGeom | null;
	points?: TracePoint[] | null;
	name?: string | null;
	tier?: number | null;
	difficultyNote?: string | null;
	/** Manual freehand confidence; typically 1.0. */
	score?: number | null;
	/** Image pathway layer ids for freehand-classify (same as legend assignedPathways). */
	assignedPathways?: string[];
	assignedPathway?: string | null;
	/**
	 * Optional PNG (raw base64, no data: prefix) for a freehand legend-style icon.
	 * Server writes `workspace/freehand-icons/{id}.png` and sets `iconRel`.
	 */
	iconPngBase64?: string | null;
	note?: string;
	id?: string;
}): Promise<{ ok: boolean; trainingFeedback: { feedback: TrainingFeedback[] } }> {
	return sendJson('/api/training-feedback', 'POST', payload);
}

export async function waitForJob(
	id: string,
	onUpdate?: (job: JobState) => void,
	intervalMs = 800,
): Promise<JobState> {
	for (;;) {
		const job = await fetchJob(id);
		onUpdate?.(job);
		if (job.status === 'succeeded' || job.status === 'failed') return job;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

export function assetUrl(path: string, bust?: string | number): string {
	const q = bust != null ? `?t=${encodeURIComponent(String(bust))}` : '';
	return `${path}${q}`;
}

/** List saved analyses. */
export function fetchAnalyses(): Promise<{ analyses: LabState['analyses'] }> {
	return getJson('/api/analyses');
}

/** Open (restore) a saved analysis into the live workspace. */
export function openAnalysis(id: string): Promise<{ ok: boolean }> {
	return sendJson(`/api/analyses/${encodeURIComponent(id)}/open`, 'POST');
}

/** Create a new empty analysis and enter classify flow. */
export function createNewAnalysis(name?: string): Promise<{ ok: boolean }> {
	return sendJson('/api/analyses/new', 'POST', { name });
}

/**
 * Rename a saved analysis (instant save; no snapshot / pipeline work).
 * @param id - Analysis id
 * @param name - New display name
 */
export function renameAnalysis(
	id: string,
	name: string,
): Promise<{
	ok: boolean;
	id: string;
	name: string;
	analyses: LabState['analyses'];
}> {
	return sendJson(`/api/analyses/${encodeURIComponent(id)}/name`, 'PUT', { name });
}

/**
 * Permanently delete a saved analysis.
 * @param id - Analysis id
 */
export function deleteAnalysis(id: string): Promise<{
	ok: boolean;
	id: string;
	analyses: LabState['analyses'];
	session?: LabState['session'];
}> {
	return sendJson(`/api/analyses/${encodeURIComponent(id)}`, 'DELETE');
}

/** Seed/open the current checked-in cutaway analysis. */
export function seedCurrentAnalysis(): Promise<{ ok: boolean }> {
	return sendJson('/api/analyses/seed-current', 'POST');
}

/** Snapshot live workspace into the active (or new) analysis. */
export function saveCurrentAnalysis(name?: string): Promise<{ ok: boolean }> {
	return sendJson('/api/analyses/save-current', 'POST', { name });
}

/** Return to the home picker (snapshots active analysis first). */
export function goHome(): Promise<{ ok: boolean }> {
	return sendJson('/api/session/home', 'POST');
}

/** Set classify vs refine phase for the active analysis. */
export function setSessionPhase(phase: 'classify' | 'refine'): Promise<{ ok: boolean }> {
	return sendJson('/api/session/phase', 'POST', { phase });
}

/**
 * Raise (or set) the Tier to Test unlock gate for the active analysis.
 * Optionally advances tierToTest + refineScreen in the same write so Mark Complete
 * cannot race a stale snapshot that still has the previous tier.
 * @param maxUnlockedTier - Highest selectable tier (1–3)
 * @param opts - Optional focus tier / refine sub-view to set atomically
 */
export function setTierGate(
	maxUnlockedTier: number,
	opts: { tierToTest?: number; refineScreen?: 'image' | 'database' | 'legend' } = {},
): Promise<{
	ok: boolean;
	maxUnlockedTier: number;
	tierToTest?: number;
	refineScreen?: string;
}> {
	return sendJson('/api/session/tier-gate', 'PUT', { maxUnlockedTier, ...opts });
}

/**
 * Persist resumable refine UI state (tier selection + sub-view) on the active analysis.
 * @param patch - Partial UI state
 */
export function saveSessionUiState(patch: {
	tierToTest?: number;
	refineScreen?: 'image' | 'database' | 'legend';
}): Promise<{
	ok: boolean;
	tierToTest: number;
	refineScreen: string;
}> {
	return sendJson('/api/session/ui-state', 'PUT', patch);
}

/**
 * Upload images into a specific analysis folder.
 * @param id - Analysis id
 * @param cutaway - Cutaway file
 * @param legend - Legend file
 * @param name - Optional rename
 */
export async function uploadAnalysisImages(
	id: string,
	cutaway: File | null,
	legend: File | null,
	name?: string,
): Promise<unknown> {
	const form = new FormData();
	if (cutaway) form.append('cutaway', cutaway);
	if (legend) form.append('legend', legend);
	if (name) form.append('name', name);
	const res = await fetch(`/api/analyses/${encodeURIComponent(id)}/images`, {
		method: 'POST',
		body: form,
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

/**
 * Bind a style-guide profile to the active analysis (after upload / anytime).
 * @param profileId - Catalog profile id (e.g. milad-lab-biomedical-illustration)
 */
export function setStyleGuideProfile(profileId: string): Promise<{
	ok: boolean;
	styleGuideProfileId: string;
	styleGuideProfile: StyleGuideProfileBrief | null;
	state: LabState;
}> {
	return sendJson('/api/session/style-guide-profile', 'PUT', { profileId });
}

/**
 * Load the full style-guide profile (includes markdown body).
 * @param profileId - Catalog profile id
 */
export function fetchStyleGuideProfile(profileId: string): Promise<{
	ok: boolean;
	profile: StyleGuideProfileBrief & {
		markdown?: string | null;
		appliesTo?: string[];
		markdownFile?: string | null;
	};
}> {
	return getJson(`/api/style-guide-profiles/${encodeURIComponent(profileId)}`);
}

/**
 * Overwrite the current style-guide profile on disk (Save).
 * @param profileId - Existing catalog id
 * @param profile - Profile fields to write
 * @param markdown - Optional markdown body
 */
export function saveStyleGuideProfile(
	profileId: string,
	profile: Record<string, unknown>,
	markdown?: string | null,
): Promise<{
	ok: boolean;
	styleGuideProfileId: string;
	styleGuideProfile: StyleGuideProfileBrief | null;
	profiles: StyleGuideProfileSummary[];
	state: LabState;
}> {
	return sendJson(`/api/style-guide-profiles/${encodeURIComponent(profileId)}`, 'PUT', {
		profile,
		markdown,
	});
}

/**
 * Create a new style-guide profile from a draft (Save as new) and bind the session.
 * @param profile - Profile fields
 * @param opts - Optional new id + markdown
 */
export function saveStyleGuideProfileAsNew(
	profile: Record<string, unknown>,
	opts?: { id?: string; markdown?: string | null },
): Promise<{
	ok: boolean;
	styleGuideProfileId: string;
	styleGuideProfile: StyleGuideProfileBrief | null;
	profiles: StyleGuideProfileSummary[];
	state: LabState;
}> {
	return sendJson('/api/style-guide-profiles', 'POST', {
		id: opts?.id,
		profile,
		markdown: opts?.markdown,
		bindToSession: true,
	});
}
