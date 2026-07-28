/**
 * API helpers for saved analyses + session screens.
 */
import type {
	Annotation,
	JobState,
	LabState,
	LegendItemRow,
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

export function startMatch(): Promise<JobState> {
	return sendJson<JobState>('/api/match', 'POST');
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
	},
): Promise<{ ok: boolean; annotations: { annotations: Annotation[] } }> {
	return sendJson('/api/annotations', 'PUT', annotation);
}

/**
 * Append a tier-2 geometry (or mirrored review) feedback entry.
 * @param payload - Feedback kind, code, optional from/to box and polyline
 */
export function saveTrainingFeedback(payload: {
	code: string;
	kind: TrainingFeedbackKind;
	from?: BoxGeom | null;
	to?: BoxGeom | null;
	points?: TracePoint[] | null;
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
