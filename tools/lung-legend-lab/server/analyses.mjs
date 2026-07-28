/**
 * Saved image-analysis store for the lung legend lab.
 *
 * Each analysis is a folder under tools/lung-legend-lab/analyses/{id}/
 * holding cutaway/legend images plus extract, classification, match,
 * findings, annotations, and outline layer snapshots.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	WORKSPACE,
	DEFAULT_CUTAWAY,
	DEFAULT_LEGEND,
	EXTRACT_JSON,
	CLASSIFICATION_JSON,
	FINDINGS_DB,
	MATCH_REPORT,
	ANNOTATIONS_JSON,
	TRAINING_FEEDBACK_JSON,
	LAYERS_DIR,
	FIGURES,
	toRepoRel,
} from './paths.mjs';

/** Root folder for persisted analyses. */
export const ANALYSES_DIR = path.join(WORKSPACE, 'analyses');

/** Sidecar index of saved analyses (also discoverable via folders). */
export const ANALYSES_INDEX = path.join(ANALYSES_DIR, 'index.json');

/**
 * @typedef {object} AnalysisMeta
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'classify' | 'refine'} phase
 * @property {boolean} usingDefaults
 * @property {string | null} notes
 */

/**
 * Ensure analyses directory + index exist; seed the current cutaway analysis once.
 * @returns {Promise<void>}
 */
export async function ensureAnalysesStore() {
	await fsp.mkdir(ANALYSES_DIR, { recursive: true });
	if (!fs.existsSync(ANALYSES_INDEX)) {
		await fsp.writeFile(ANALYSES_INDEX, JSON.stringify({ analyses: [] }, null, 2), 'utf8');
	}
	const index = await readIndex();
	if (index.analyses.length === 0) {
		await seedCurrentAnalysis();
	}
}

/**
 * Read the analyses index file.
 * @returns {Promise<{analyses: AnalysisMeta[]}>}
 */
async function readIndex() {
	await fsp.mkdir(ANALYSES_DIR, { recursive: true });
	try {
		return JSON.parse(await fsp.readFile(ANALYSES_INDEX, 'utf8'));
	} catch {
		return { analyses: [] };
	}
}

/**
 * Write the analyses index.
 * @param {{analyses: AnalysisMeta[]}} index
 * @returns {Promise<void>}
 */
async function writeIndex(index) {
	await fsp.writeFile(ANALYSES_INDEX, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * Absolute path for one analysis folder.
 * @param {string} id
 * @returns {string}
 */
export function analysisDir(id) {
	return path.join(ANALYSES_DIR, id);
}

/**
 * Paths inside an analysis folder.
 * @param {string} id
 */
export function analysisPaths(id) {
	const root = analysisDir(id);
	return {
		root,
		meta: path.join(root, 'meta.json'),
		cutaway: path.join(root, 'cutaway.png'),
		legend: path.join(root, 'legend.png'),
		extract: path.join(root, 'legend-extract.json'),
		classification: path.join(root, 'legend-classification.json'),
		findings: path.join(root, 'legend-findings-db.json'),
		matchReport: path.join(root, 'template-match-report.json'),
		annotations: path.join(root, 'lab-annotations.json'),
		trainingFeedback: path.join(root, 'lab-training-feedback.json'),
		layers: path.join(root, 'layers'),
	};
}

/**
 * Copy a file if the source exists.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<boolean>}
 */
async function copyIfExists(from, to) {
	if (!fs.existsSync(from)) return false;
	await fsp.mkdir(path.dirname(to), { recursive: true });
	await fsp.copyFile(from, to);
	return true;
}

/**
 * Snapshot outline PNGs into an analysis layers folder.
 * @param {string} destDir
 * @returns {Promise<number>}
 */
async function snapshotLayers(destDir) {
	await fsp.mkdir(destDir, { recursive: true });
	let count = 0;
	if (!fs.existsSync(LAYERS_DIR)) return 0;
	const names = await fsp.readdir(LAYERS_DIR);
	for (const name of names) {
		if (!name.endsWith('.png')) continue;
		await fsp.copyFile(path.join(LAYERS_DIR, name), path.join(destDir, name));
		count += 1;
	}
	return count;
}

/**
 * Restore outline PNGs from an analysis into the shared layers dir.
 * @param {string} srcDir
 * @returns {Promise<number>}
 */
async function restoreLayers(srcDir) {
	if (!fs.existsSync(srcDir)) return 0;
	await fsp.mkdir(LAYERS_DIR, { recursive: true });
	let count = 0;
	const names = await fsp.readdir(srcDir);
	for (const name of names) {
		if (!name.endsWith('.png')) continue;
		await fsp.copyFile(path.join(srcDir, name), path.join(LAYERS_DIR, name));
		count += 1;
	}
	return count;
}

/**
 * Seed an analysis from the current checked-in cutaway + pipeline artifacts.
 * @returns {Promise<AnalysisMeta>}
 */
export async function seedCurrentAnalysis() {
	const id = 'lung-cutaway-neutral';
	const now = new Date().toISOString();
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });

	await copyIfExists(DEFAULT_CUTAWAY, paths.cutaway);
	await copyIfExists(DEFAULT_LEGEND, paths.legend);
	await copyIfExists(EXTRACT_JSON, paths.extract);
	await copyIfExists(CLASSIFICATION_JSON, paths.classification);
	await copyIfExists(FINDINGS_DB, paths.findings);
	await copyIfExists(MATCH_REPORT, paths.matchReport);
	await copyIfExists(ANNOTATIONS_JSON, paths.annotations);
	await copyIfExists(TRAINING_FEEDBACK_JSON, paths.trainingFeedback);
	await snapshotLayers(paths.layers);

	/** @type {AnalysisMeta} */
	const meta = {
		id,
		name: 'Lung Cutaway Neutral (current)',
		createdAt: now,
		updatedAt: now,
		phase: fs.existsSync(paths.classification) ? 'refine' : 'classify',
		usingDefaults: true,
		notes: 'Seeded from checked-in cutaway + legend and latest pipeline outputs.',
	};
	await fsp.writeFile(paths.meta, JSON.stringify(meta, null, 2), 'utf8');

	const index = await readIndex();
	index.analyses = [meta, ...index.analyses.filter((a) => a.id !== id)];
	await writeIndex(index);
	return meta;
}

/**
 * List saved analyses (newest updated first).
 * @returns {Promise<AnalysisMeta[]>}
 */
export async function listAnalyses() {
	await ensureAnalysesStore();
	const index = await readIndex();
	return [...index.analyses].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Read one analysis meta, or null.
 * @param {string} id
 * @returns {Promise<AnalysisMeta | null>}
 */
export async function getAnalysisMeta(id) {
	const p = analysisPaths(id).meta;
	if (!fs.existsSync(p)) return null;
	return JSON.parse(await fsp.readFile(p, 'utf8'));
}

/**
 * Create a new empty analysis shell (images filled later).
 * @param {string} [name]
 * @returns {Promise<AnalysisMeta>}
 */
export async function createAnalysis(name = 'Untitled analysis') {
	await ensureAnalysesStore();
	const id = `analysis-${randomUUID().slice(0, 8)}`;
	const now = new Date().toISOString();
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.layers, { recursive: true });
	/** @type {AnalysisMeta} */
	const meta = {
		id,
		name,
		createdAt: now,
		updatedAt: now,
		phase: 'classify',
		usingDefaults: false,
		notes: null,
	};
	await fsp.writeFile(paths.meta, JSON.stringify(meta, null, 2), 'utf8');
	await fsp.writeFile(paths.annotations, JSON.stringify({ annotations: [] }, null, 2), 'utf8');
	await fsp.writeFile(paths.trainingFeedback, JSON.stringify({ feedback: [] }, null, 2), 'utf8');

	const index = await readIndex();
	index.analyses.unshift(meta);
	await writeIndex(index);
	return meta;
}

/**
 * Persist meta updates and refresh the index entry.
 * @param {string} id
 * @param {Partial<AnalysisMeta>} patch
 * @returns {Promise<AnalysisMeta>}
 */
export async function updateAnalysisMeta(id, patch) {
	const paths = analysisPaths(id);
	const current = (await getAnalysisMeta(id)) || {
		id,
		name: id,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		phase: 'classify',
		usingDefaults: false,
		notes: null,
	};
	const next = {
		...current,
		...patch,
		id,
		updatedAt: new Date().toISOString(),
	};
	await fsp.mkdir(paths.root, { recursive: true });
	await fsp.writeFile(paths.meta, JSON.stringify(next, null, 2), 'utf8');
	const index = await readIndex();
	const others = index.analyses.filter((a) => a.id !== id);
	index.analyses = [next, ...others];
	await writeIndex(index);
	return next;
}

/**
 * Snapshot the live workspace / pipeline outputs into an analysis folder.
 * @param {string} id
 * @param {{cutawayPath: string, legendPath: string, usingDefaults?: boolean, phase?: 'classify' | 'refine', name?: string}} session
 * @returns {Promise<AnalysisMeta>}
 */
export async function snapshotAnalysis(id, session) {
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });
	await copyIfExists(session.cutawayPath, paths.cutaway);
	await copyIfExists(session.legendPath, paths.legend);
	await copyIfExists(EXTRACT_JSON, paths.extract);
	await copyIfExists(CLASSIFICATION_JSON, paths.classification);
	await copyIfExists(FINDINGS_DB, paths.findings);
	await copyIfExists(MATCH_REPORT, paths.matchReport);
	await copyIfExists(ANNOTATIONS_JSON, paths.annotations);
	await copyIfExists(TRAINING_FEEDBACK_JSON, paths.trainingFeedback);
	await snapshotLayers(paths.layers);

	const phase =
		session.phase ||
		(fs.existsSync(paths.classification) && fs.existsSync(paths.findings) ? 'refine' : 'classify');

	return updateAnalysisMeta(id, {
		phase,
		usingDefaults: Boolean(session.usingDefaults),
		...(session.name ? { name: session.name } : {}),
	});
}

/**
 * Restore an analysis into the live pipeline paths and return session pointers.
 * @param {string} id
 * @returns {Promise<{cutawayPath: string, legendPath: string, usingDefaults: boolean, analysisId: string, phase: string, updatedAt: string}>}
 */
export async function restoreAnalysis(id) {
	const paths = analysisPaths(id);
	const meta = await getAnalysisMeta(id);
	if (!meta || !fs.existsSync(paths.cutaway) || !fs.existsSync(paths.legend)) {
		throw new Error(`Analysis ${id} is missing images`);
	}

	// Working copies for mutable pipeline I/O (keep originals in analysis folder).
	const workCutaway = path.join(WORKSPACE, 'active-cutaway.png');
	const workLegend = path.join(WORKSPACE, 'active-legend.png');
	await fsp.copyFile(paths.cutaway, workCutaway);
	await fsp.copyFile(paths.legend, workLegend);

	await copyIfExists(paths.extract, EXTRACT_JSON);
	await copyIfExists(paths.classification, CLASSIFICATION_JSON);
	await copyIfExists(paths.findings, FINDINGS_DB);
	await copyIfExists(paths.matchReport, MATCH_REPORT);
	await copyIfExists(paths.annotations, ANNOTATIONS_JSON);
	if (fs.existsSync(paths.trainingFeedback)) {
		await copyIfExists(paths.trainingFeedback, TRAINING_FEEDBACK_JSON);
	} else {
		await fsp.writeFile(TRAINING_FEEDBACK_JSON, JSON.stringify({ feedback: [] }, null, 2), 'utf8');
	}
	await restoreLayers(paths.layers);

	return {
		cutawayPath: workCutaway,
		legendPath: workLegend,
		usingDefaults: Boolean(meta.usingDefaults),
		analysisId: id,
		phase: meta.phase,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Write uploaded images into an analysis folder and working paths.
 * @param {string} id
 * @param {{cutaway?: Buffer, legend?: Buffer}} files
 * @returns {Promise<{cutawayPath: string, legendPath: string}>}
 */
export async function writeAnalysisImages(id, files) {
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });
	const workCutaway = path.join(WORKSPACE, 'active-cutaway.png');
	const workLegend = path.join(WORKSPACE, 'active-legend.png');

	if (files.cutaway) {
		await fsp.writeFile(paths.cutaway, files.cutaway);
		await fsp.writeFile(workCutaway, files.cutaway);
	}
	if (files.legend) {
		await fsp.writeFile(paths.legend, files.legend);
		await fsp.writeFile(workLegend, files.legend);
	}

	await updateAnalysisMeta(id, { usingDefaults: false, phase: 'classify' });
	return {
		cutawayPath: fs.existsSync(workCutaway) ? workCutaway : paths.cutaway,
		legendPath: fs.existsSync(workLegend) ? workLegend : paths.legend,
	};
}

/**
 * Summarize an analysis for the home list UI.
 * @param {AnalysisMeta} meta
 * @returns {Promise<object>}
 */
export async function summarizeAnalysis(meta) {
	const paths = analysisPaths(meta.id);
	const findings = fs.existsSync(paths.findings)
		? JSON.parse(await fsp.readFile(paths.findings, 'utf8'))
		: null;
	const t1 = findings?.stats?.tier1 || {};
	return {
		...meta,
		hasCutaway: fs.existsSync(paths.cutaway),
		hasLegend: fs.existsSync(paths.legend),
		hasClassification: fs.existsSync(paths.classification),
		hasFindings: fs.existsSync(paths.findings),
		tier1Found: t1.found ?? null,
		tier1Expected: t1.expected ?? null,
		tier1Instances: t1.instanceTotal ?? null,
		cutawayRel: fs.existsSync(paths.cutaway) ? toRepoRel(paths.cutaway) : null,
		legendRel: fs.existsSync(paths.legend) ? toRepoRel(paths.legend) : null,
		figuresRoot: toRepoRel(FIGURES),
	};
}
