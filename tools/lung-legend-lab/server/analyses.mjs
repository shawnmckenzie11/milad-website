/**
 * Saved image-analysis store for the lung legend lab.
 *
 * Each analysis is a folder under tools/lung-legend-lab/workspace/analyses/{id}/
 * holding cutaway/legend images plus extract, classification, match,
 * findings, annotations, outline layers, legend glyph crops, and a
 * style-guide snapshot (profile JSON/MD + synthesized legend context).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	WORKSPACE,
	LIVE_OWNER_PATH,
	DEFAULT_CUTAWAY,
	DEFAULT_LEGEND,
	EXTRACT_JSON,
	CLASSIFICATION_JSON,
	FINDINGS_DB,
	MATCH_REPORT,
	ANNOTATIONS_JSON,
	TRAINING_FEEDBACK_JSON,
	FREEHAND_ICONS_DIR,
	LAYERS_DIR,
	LEGEND_ITEMS_DIR,
	FIGURES,
	RL_FEEDBACK_JSON,
	RL_FEEDBACK_MD,
	toRepoRel,
} from './paths.mjs';
import {
	DEFAULT_STYLE_GUIDE_PROFILE_ID,
	writeStyleGuideSnapshot,
	readStyleGuideSnapshotBrief,
	getStyleGuideProfileBrief,
} from './styleGuides.mjs';

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
 * @property {string | null} [styleGuideProfileId]
 * @property {number} [maxUnlockedTier] Highest Tier to Test the owner may select (1–3).
 * @property {'home' | 'classify' | 'refine'} [screen] Last UI screen for resume.
 * @property {'image' | 'database' | 'legend'} [refineScreen] Refine sub-view for resume.
 * @property {number} [tierToTest] Last Tier to Test selection (1–3).
 * @property {boolean} [hasStyleGuideSnapshot] True when style-guide/ was snapshotted.
 */

/**
 * Ensure analyses directory + index exist.
 * Does **not** auto-seed a default analysis when the list is empty — that blocked
 * deleting the last / "current" analysis. First-launch seeding lives in the server
 * workspace bootstrap (`ensureWorkspace`) via explicit `seedCurrentAnalysis()`.
 * @returns {Promise<void>}
 */
export async function ensureAnalysesStore() {
	await fsp.mkdir(ANALYSES_DIR, { recursive: true });
	if (!fs.existsSync(ANALYSES_INDEX)) {
		await fsp.writeFile(ANALYSES_INDEX, JSON.stringify({ analyses: [] }, null, 2), 'utf8');
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
		legendItems: path.join(root, 'legend-items'),
		freehandIcons: path.join(root, 'freehand-icons'),
		styleGuide: path.join(root, 'style-guide'),
		styleGuideJson: path.join(root, 'style-guide', 'profile.json'),
		styleGuideMd: path.join(root, 'style-guide', 'profile.md'),
		legendContext: path.join(root, 'style-guide', 'legend-context.json'),
		rlFeedback: path.join(root, 'rl-feedback.json'),
		rlFeedbackMd: path.join(root, 'rl-feedback-prompt.md'),
		rlFeedbackHistory: path.join(root, 'rl-feedback-history.json'),
	};
}

/**
 * Read the analysis id that currently owns the shared live pipeline paths.
 * `null` means unowned (fresh workspace or no analysis bound).
 * @returns {Promise<string | null>}
 */
export async function readLiveOwnerId() {
	try {
		const raw = JSON.parse(await fsp.readFile(LIVE_OWNER_PATH, 'utf8'));
		return typeof raw.analysisId === 'string' && raw.analysisId ? raw.analysisId : null;
	} catch {
		return null;
	}
}

/**
 * Claim (or release) the live workspace for one analysis.
 * @param {string | null} id - Analysis id, or null to release
 * @returns {Promise<string | null>}
 */
export async function setLiveOwnerId(id) {
	await fsp.mkdir(WORKSPACE, { recursive: true });
	await fsp.writeFile(
		LIVE_OWNER_PATH,
		JSON.stringify(
			{
				analysisId: id || null,
				claimedAt: new Date().toISOString(),
				note: 'Only this analysis may snapshot the shared live pipeline outputs.',
			},
			null,
			2,
		),
		'utf8',
	);
	return id || null;
}

/**
 * Whether the analysis holding the live lease still exists on disk.
 * A lease naming a folder that is gone (analysis deleted outside the app, or a
 * crash between `rm` and lease release) is dangling: it can never be reclaimed
 * by its owner, so it would silently block *every* other analysis from
 * snapshotting and make the lab look like it lost all pipeline results.
 * @param {string | null} owner - Lease holder id
 * @returns {boolean}
 */
function liveOwnerExists(owner) {
	return Boolean(owner) && fs.existsSync(analysisPaths(owner).meta);
}

/**
 * Whether `id` may write the shared live state back into its own folder.
 * An unowned workspace is adopted by the first writer so legacy sessions keep
 * working, and a lease left behind by a deleted analysis is treated the same
 * way rather than deadlocking the shared pipeline paths.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function canSnapshotLive(id) {
	const owner = await readLiveOwnerId();
	if (owner === id) return true;
	if (!owner || !liveOwnerExists(owner)) {
		if (owner) {
			console.warn(
				`[lung-lab] live lease held by missing analysis ${owner}; reassigning to ${id}`,
			);
		}
		await setLiveOwnerId(id);
		return true;
	}
	return false;
}

/**
 * Reset the shared live pipeline state so a newly claimed analysis starts from
 * nothing instead of inheriting the previous analysis's outputs.
 *
 * Deliberately leaves the checked-in PNGs in `layers/` and `debug/legend-items/`
 * on disk (they are site artwork / repo artifacts). Isolation for those comes
 * from per-analysis snapshots plus per-analysis asset serving, not deletion.
 *
 * @returns {Promise<void>}
 */
export async function clearLiveWorkspace() {
	const now = new Date().toISOString();
	await writeJson(EXTRACT_JSON, { items: [], source: null, updatedAt: now });
	await writeJson(CLASSIFICATION_JSON, {
		source: null,
		guidelines: '',
		classifications: {},
		updatedAt: now,
		updatedBy: 'lung-legend-lab',
	});
	await writeJson(FINDINGS_DB, { items: {}, runs: [], meta: { phase: 'new analysis' } });
	await writeJson(MATCH_REPORT, { layers: {}, method: 'opencv-template-match' });
	await writeJson(ANNOTATIONS_JSON, { annotations: [], updatedAt: now });
	await writeJson(TRAINING_FEEDBACK_JSON, { feedback: [], updatedAt: now });
	await writeJson(RL_FEEDBACK_JSON, {
		tierToTest: 1,
		generatedAt: null,
		summary: null,
		cursor: null,
		note: 'No RL feedback exported for this analysis yet.',
	});
	await fsp.writeFile(RL_FEEDBACK_MD, '# RL feedback\n\n(none yet)\n', 'utf8');
	await emptyPngDir(FREEHAND_ICONS_DIR);
	// Legacy shared image copies: analyses now point straight at their own files.
	for (const legacy of ['active-cutaway.png', 'active-legend.png']) {
		await fsp.rm(path.join(WORKSPACE, legacy), { force: true });
	}
}

/**
 * Write pretty JSON, creating parent directories.
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function writeJson(filePath, data) {
	await fsp.mkdir(path.dirname(filePath), { recursive: true });
	await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Delete every PNG in a directory (kept, so live dirs never mix two analyses).
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function emptyPngDir(dir) {
	await fsp.mkdir(dir, { recursive: true });
	let removed = 0;
	for (const name of await fsp.readdir(dir)) {
		if (!name.endsWith('.png')) continue;
		await fsp.rm(path.join(dir, name), { force: true });
		removed += 1;
	}
	return removed;
}

/**
 * Copy PNGs from `srcDir` to `destDir` and drop dest PNGs the source no longer
 * has, so a snapshot cannot accumulate another analysis's leftovers.
 * Skipped entirely when the source is empty but the destination is not — an
 * empty live dir must never wipe a saved analysis.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @returns {Promise<number>} Files present in dest after the mirror
 */
async function mirrorPngDir(srcDir, destDir) {
	await fsp.mkdir(destDir, { recursive: true });
	const src = fs.existsSync(srcDir)
		? (await fsp.readdir(srcDir)).filter((n) => n.endsWith('.png'))
		: [];
	const dest = (await fsp.readdir(destDir)).filter((n) => n.endsWith('.png'));
	if (src.length === 0) return dest.length;
	for (const name of src) {
		await fsp.copyFile(path.join(srcDir, name), path.join(destDir, name));
	}
	const keep = new Set(src);
	for (const name of dest) {
		if (!keep.has(name)) await fsp.rm(path.join(destDir, name), { force: true });
	}
	return src.length;
}

/**
 * Copy a file if the source exists (self-copies are a no-op).
 * @param {string} from
 * @param {string} to
 * @returns {Promise<boolean>}
 */
async function copyIfExists(from, to) {
	if (!fs.existsSync(from)) return false;
	if (path.resolve(from) === path.resolve(to)) return true;
	await fsp.mkdir(path.dirname(to), { recursive: true });
	await fsp.copyFile(from, to);
	return true;
}

/**
 * Read JSON if the file exists; otherwise null.
 * @param {string} filePath
 * @returns {Promise<object | null>}
 */
async function readJsonIfExists(filePath) {
	if (!fs.existsSync(filePath)) return null;
	try {
		return JSON.parse(await fsp.readFile(filePath, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Slugs and legend codes this analysis owns, from its own classification /
 * match report / extract. Used to keep another analysis's live PNGs out of the
 * snapshot: the shared layers + legend-items dirs are single-tenant scratch.
 *
 * @param {string} id
 * @returns {Promise<{slugs: Set<string>, codes: Set<string>}>}
 */
async function analysisOwnedNames(id) {
	const paths = analysisPaths(id);
	const [classification, report, extract] = await Promise.all([
		readJsonIfExists(paths.classification),
		readJsonIfExists(paths.matchReport),
		readJsonIfExists(paths.extract),
	]);
	const slugs = new Set();
	const codes = new Set();
	for (const [code, cls] of Object.entries(classification?.classifications || {})) {
		codes.add(code);
		if (typeof cls?.slug === 'string' && cls.slug.trim()) slugs.add(cls.slug.trim());
	}
	for (const [slug, layer] of Object.entries(report?.layers || {})) {
		if (slug) slugs.add(slug);
		if (layer?.legendCode) codes.add(String(layer.legendCode));
	}
	for (const item of Array.isArray(extract?.items) ? extract.items : []) {
		if (item?.code) codes.add(String(item.code));
	}
	return { slugs, codes };
}

/**
 * Snapshot this analysis's own outline PNGs from the shared layers dir.
 * Filtering by owned slugs is what stops a sibling analysis's outlines (left in
 * the shared dir by the site build or a previous run) from being saved here.
 *
 * @param {string} destDir
 * @param {Set<string>} slugs - Layer slugs owned by this analysis
 * @returns {Promise<number>}
 */
async function snapshotLayers(destDir, slugs) {
	const wanted = new Set();
	for (const slug of slugs) {
		wanted.add(`${slug}.png`);
		wanted.add(`${slug}-outline.png`);
	}
	return copyPngSubset(LAYERS_DIR, destDir, wanted);
}

/**
 * Restore an analysis's outline PNGs into the shared layers dir.
 * Additive on purpose: that dir also holds checked-in site artwork.
 * @param {string} srcDir
 * @returns {Promise<number>}
 */
async function restoreLayers(srcDir) {
	return copyPngSubset(srcDir, LAYERS_DIR, null);
}

/**
 * Snapshot this analysis's own legend glyph/row crops.
 * @param {string} destDir
 * @param {Set<string>} codes - Legend codes owned by this analysis
 * @returns {Promise<number>}
 */
async function snapshotLegendItems(destDir, codes) {
	const wanted = new Set();
	for (const code of codes) {
		wanted.add(`${code}-glyph.png`);
		wanted.add(`${code}-row.png`);
	}
	return copyPngSubset(LEGEND_ITEMS_DIR, destDir, wanted);
}

/**
 * Restore legend glyph/row crops into the live debug folder (additive).
 * @param {string} srcDir
 * @returns {Promise<number>}
 */
async function restoreLegendItems(srcDir) {
	return copyPngSubset(srcDir, LEGEND_ITEMS_DIR, null);
}

/**
 * Copy PNGs from `srcDir` into `destDir`, optionally limited to `wanted`
 * filenames. When a filter is given, dest PNGs outside it are pruned so the
 * snapshot holds only this analysis's files.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @param {Set<string> | null} wanted - Allowed filenames, or null for all
 * @returns {Promise<number>} Number of files copied
 */
async function copyPngSubset(srcDir, destDir, wanted) {
	await fsp.mkdir(destDir, { recursive: true });
	const names = fs.existsSync(srcDir)
		? (await fsp.readdir(srcDir)).filter((n) => n.endsWith('.png'))
		: [];
	let copied = 0;
	for (const name of names) {
		if (wanted && !wanted.has(name)) continue;
		await fsp.copyFile(path.join(srcDir, name), path.join(destDir, name));
		copied += 1;
	}
	if (wanted && wanted.size > 0) {
		for (const name of (await fsp.readdir(destDir)).filter((n) => n.endsWith('.png'))) {
			if (!wanted.has(name)) await fsp.rm(path.join(destDir, name), { force: true });
		}
	}
	return copied;
}

/**
 * Copy live freehand legend-style icons into an analysis snapshot.
 * @param {string} destDir
 * @returns {Promise<number>}
 */
async function snapshotFreehandIcons(destDir) {
	return mirrorPngDir(FREEHAND_ICONS_DIR, destDir);
}

/**
 * Restore freehand icons into the live workspace folder.
 * Prunes icons belonging to another analysis's review session.
 * @param {string} srcDir
 * @returns {Promise<number>}
 */
async function restoreFreehandIcons(srcDir) {
	await emptyPngDir(FREEHAND_ICONS_DIR);
	return mirrorPngDir(srcDir, FREEHAND_ICONS_DIR);
}

/**
 * Snapshot live RL feedback artifacts into the analysis folder.
 * @param {ReturnType<typeof analysisPaths>} paths
 * @returns {Promise<void>}
 */
async function snapshotRlFeedback(paths) {
	await copyIfExists(RL_FEEDBACK_JSON, paths.rlFeedback);
	await copyIfExists(RL_FEEDBACK_MD, paths.rlFeedbackMd);
	if (!fs.existsSync(paths.rlFeedbackHistory)) {
		await fsp.writeFile(
			paths.rlFeedbackHistory,
			JSON.stringify({ entries: [] }, null, 2),
			'utf8',
		);
	}
}

/**
 * Restore RL feedback into the live workspace (empty stubs when missing).
 * @param {ReturnType<typeof analysisPaths>} paths
 * @returns {Promise<void>}
 */
async function restoreRlFeedback(paths) {
	if (fs.existsSync(paths.rlFeedback)) {
		await copyIfExists(paths.rlFeedback, RL_FEEDBACK_JSON);
	} else {
		await fsp.writeFile(
			RL_FEEDBACK_JSON,
			JSON.stringify(
				{
					tierToTest: 1,
					generatedAt: null,
					summary: null,
					cursor: null,
					note: 'No RL feedback exported for this analysis yet.',
				},
				null,
				2,
			),
			'utf8',
		);
	}
	if (fs.existsSync(paths.rlFeedbackMd)) {
		await copyIfExists(paths.rlFeedbackMd, RL_FEEDBACK_MD);
	} else {
		await fsp.writeFile(RL_FEEDBACK_MD, '# RL feedback\n\n(none yet)\n', 'utf8');
	}
}

/**
 * Append one generated RL prompt to the per-analysis history log.
 * @param {string} analysisId
 * @param {object} entry - Prompt payload (tier, markdown, summary, cursor, …)
 * @returns {Promise<void>}
 */
export async function appendRlFeedbackHistory(analysisId, entry) {
	if (!analysisId) return;
	const paths = analysisPaths(analysisId);
	await fsp.mkdir(paths.root, { recursive: true });
	const prior = (await readJsonIfExists(paths.rlFeedbackHistory)) || { entries: [] };
	const entries = Array.isArray(prior.entries) ? prior.entries : [];
	entries.push({
		...entry,
		recordedAt: entry.recordedAt || new Date().toISOString(),
	});
	await fsp.writeFile(
		paths.rlFeedbackHistory,
		JSON.stringify({ entries }, null, 2),
		'utf8',
	);
}

/**
 * Build agent-oriented legend context JSON from extract + classification + findings.
 * @param {string} id
 * @param {object | null} styleBrief
 * @returns {Promise<object>}
 */
async function buildLegendContext(id, styleBrief) {
	const paths = analysisPaths(id);
	const extract = await readJsonIfExists(paths.extract);
	const classification = await readJsonIfExists(paths.classification);
	const findings = await readJsonIfExists(paths.findings);
	const classes = classification?.classifications || {};
	const findingItems = findings?.items || {};
	const extracted = Array.isArray(extract?.items) ? extract.items : [];
	const codes = new Set([
		...extracted.map((i) => i.code),
		...Object.keys(classes),
		...Object.keys(findingItems),
	]);
	const legendItems = [...codes]
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.map((code) => {
			const ex = extracted.find((i) => i.code === code) || {};
			const cls = classes[code] || {};
			const find = findingItems[code] || {};
			const glyphName = `${code}-glyph.png`;
			const hasGlyph = fs.existsSync(path.join(paths.legendItems, glyphName));
			const pathways = Array.isArray(cls.assignedPathways)
				? cls.assignedPathways
				: cls.assignedPathway
					? [cls.assignedPathway]
					: Array.isArray(find.assignedPathways)
						? find.assignedPathways
						: [];
			return {
				code,
				name: ex.name || find.name || code,
				id: firstNonEmpty(cls.slug, find.slug) || null,
				iconRel: hasGlyph ? `legend-items/${glyphName}` : null,
				connectedPathway: pathways[0] || null,
				assignedPathways: pathways.map(String).filter(Boolean),
				subTier: cls.subTier ?? find.subTier ?? null,
				iconInterpretation: cls.iconInterpretation ?? find.iconInterpretation ?? null,
				tier: cls.tier ?? find.tier ?? null,
				group: cls.group ?? find.group ?? null,
				searchable: cls.searchable ?? find.searchable ?? null,
				status: find.status ?? null,
				confidence: find.bestScore ?? find.meanScore ?? null,
				instanceCount: find.instanceCount ?? 0,
				location: ex.location || find.location || null,
				supports: ex.supports || find.supports || null,
			};
		});

	return {
		analysisId: id,
		updatedAt: new Date().toISOString(),
		styleGuideProfileId: styleBrief?.id || null,
		visualLanguage: styleBrief?.visualLanguage || null,
		imagePathways: styleBrief?.imagePathways || null,
		agentInstructions: [
			...(Array.isArray(styleBrief?.agentInstructions)
				? styleBrief.agentInstructions
				: []),
			'Tier 1 detection: OpenCV multi-scale template match — follow .cursor/skills/lung-legend-template-match/SKILL.md.',
			'Tier 2+: freehand / owner-assisted regions in the lab; persist via training feedback + findings DB.',
			'Prefer this legend-context.json + style-guide/profile.json over live catalog when assisting this analysis.',
		],
		legendItems,
	};
}

/**
 * Prefer the first non-empty string among candidates.
 * @param {...(string | null | undefined)} values
 * @returns {string | null}
 */
function firstNonEmpty(...values) {
	for (const v of values) {
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return null;
}

/**
 * Snapshot style guide + synthesized legend context for an analysis.
 * @param {string} id
 * @param {string | null | undefined} profileId
 * @returns {Promise<object | null>}
 */
async function snapshotStyleGuideBundle(id, profileId) {
	const paths = analysisPaths(id);
	const brief = await writeStyleGuideSnapshot(
		paths.styleGuide,
		profileId || DEFAULT_STYLE_GUIDE_PROFILE_ID,
	);
	const context = await buildLegendContext(id, brief);
	await fsp.mkdir(paths.styleGuide, { recursive: true });
	await fsp.writeFile(paths.legendContext, JSON.stringify(context, null, 2), 'utf8');
	return brief;
}

/**
 * Load style-guide brief preferring the analysis snapshot over the live catalog.
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function loadAnalysisStyleGuideBrief(id) {
	const paths = analysisPaths(id);
	const snap = await readStyleGuideSnapshotBrief(paths.styleGuide);
	if (snap) return snap;
	const meta = await getAnalysisMeta(id);
	return getStyleGuideProfileBrief(
		meta?.styleGuideProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID,
	);
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
	const owned = await analysisOwnedNames(id);
	await snapshotLayers(paths.layers, owned.slugs);
	await snapshotLegendItems(paths.legendItems, owned.codes);
	await snapshotFreehandIcons(paths.freehandIcons);
	await snapshotRlFeedback(paths);
	const existing = fs.existsSync(paths.meta)
		? JSON.parse(await fsp.readFile(paths.meta, 'utf8'))
		: null;
	const profileId = existing?.styleGuideProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID;
	await snapshotStyleGuideBundle(id, profileId);

	/** @type {AnalysisMeta} */
	const meta = {
		id,
		name: 'Lung Cutaway Neutral (current)',
		createdAt: existing?.createdAt || now,
		updatedAt: now,
		phase: fs.existsSync(paths.classification) ? 'refine' : 'classify',
		screen: existing?.screen || 'refine',
		refineScreen: existing?.refineScreen || 'image',
		tierToTest: existing?.tierToTest || 1,
		usingDefaults: true,
		notes: 'Seeded from checked-in cutaway + legend and latest pipeline outputs.',
		styleGuideProfileId: profileId,
		hasStyleGuideSnapshot: fs.existsSync(paths.styleGuideJson),
		// Seeded analysis already has full classifications — unlock all tiers.
		maxUnlockedTier: existing?.maxUnlockedTier ?? 3,
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
	await fsp.mkdir(paths.legendItems, { recursive: true });
	await fsp.mkdir(paths.freehandIcons, { recursive: true });
	/** @type {AnalysisMeta} */
	const meta = {
		id,
		name,
		createdAt: now,
		updatedAt: now,
		phase: 'classify',
		screen: 'classify',
		refineScreen: 'image',
		tierToTest: 1,
		usingDefaults: false,
		notes: null,
		styleGuideProfileId: DEFAULT_STYLE_GUIDE_PROFILE_ID,
		maxUnlockedTier: 1,
		hasStyleGuideSnapshot: false,
	};
	await fsp.writeFile(paths.meta, JSON.stringify(meta, null, 2), 'utf8');
	await fsp.writeFile(paths.annotations, JSON.stringify({ annotations: [] }, null, 2), 'utf8');
	await fsp.writeFile(paths.trainingFeedback, JSON.stringify({ feedback: [] }, null, 2), 'utf8');
	await fsp.writeFile(
		paths.rlFeedbackHistory,
		JSON.stringify({ entries: [] }, null, 2),
		'utf8',
	);
	await snapshotStyleGuideBundle(id, DEFAULT_STYLE_GUIDE_PROFILE_ID);
	meta.hasStyleGuideSnapshot = true;
	await fsp.writeFile(paths.meta, JSON.stringify(meta, null, 2), 'utf8');

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
		styleGuideProfileId: DEFAULT_STYLE_GUIDE_PROFILE_ID,
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
 * Copy live JSON into the analysis snapshot unless the live file is an empty stub
 * that would wipe a richer saved copy.
 * @param {string} from - Live path
 * @param {string} to - Snapshot path
 * @param {(data: object | null) => number} richness - Higher = keep/copy; 0 = empty stub
 */
async function copyJsonUnlessEmpty(from, to, richness) {
	const live = await readJsonIfExists(from);
	const prior = await readJsonIfExists(to);
	const liveN = richness(live);
	const priorN = richness(prior);
	if (liveN > 0 || priorN === 0) {
		await copyIfExists(from, to);
	}
}

/**
 * Snapshot the live workspace / pipeline outputs into an analysis folder.
 *
 * Refuses to write when another analysis holds the live lease: the shared
 * pipeline paths then describe *that* analysis, and copying them here is the
 * cross-analysis contamination this guard exists to prevent.
 *
 * @param {string} id
 * @param {{
 *   cutawayPath: string,
 *   legendPath: string,
 *   usingDefaults?: boolean,
 *   phase?: 'classify' | 'refine',
 *   screen?: 'home' | 'classify' | 'refine',
 *   refineScreen?: 'image' | 'database' | 'legend',
 *   tierToTest?: number,
 *   name?: string,
 *   styleGuideProfileId?: string | null,
 *   maxUnlockedTier?: number,
 * }} session
 * @returns {Promise<AnalysisMeta>}
 */
export async function snapshotAnalysis(id, session) {
	const paths = analysisPaths(id);
	if (!(await canSnapshotLive(id))) {
		const owner = await readLiveOwnerId();
		console.warn(
			`[lung-lab] skipped snapshot of ${id}: live workspace is owned by ${owner}`,
		);
		return (await getAnalysisMeta(id)) || updateAnalysisMeta(id, {});
	}
	await fsp.mkdir(paths.root, { recursive: true });
	await copyIfExists(session.cutawayPath, paths.cutaway);
	await copyIfExists(session.legendPath, paths.legend);
	await copyJsonUnlessEmpty(
		EXTRACT_JSON,
		paths.extract,
		(d) => (Array.isArray(d?.items) ? d.items.length : 0),
	);
	await copyJsonUnlessEmpty(
		CLASSIFICATION_JSON,
		paths.classification,
		(d) => Object.keys(d?.classifications || {}).length,
	);
	await copyJsonUnlessEmpty(
		FINDINGS_DB,
		paths.findings,
		(d) => Object.keys(d?.items || {}).length,
	);
	await copyJsonUnlessEmpty(
		MATCH_REPORT,
		paths.matchReport,
		(d) => Object.keys(d?.layers || {}).length,
	);
	// Copied verbatim (an emptied review list is a legitimate edit): the live
	// lease above is what keeps another analysis's stubs out of this folder.
	await copyIfExists(ANNOTATIONS_JSON, paths.annotations);
	await copyIfExists(TRAINING_FEEDBACK_JSON, paths.trainingFeedback);
	const owned = await analysisOwnedNames(id);
	await snapshotLayers(paths.layers, owned.slugs);
	await snapshotLegendItems(paths.legendItems, owned.codes);
	await snapshotFreehandIcons(paths.freehandIcons);
	await snapshotRlFeedback(paths);

	const prior = await getAnalysisMeta(id);
	const profileId =
		session.styleGuideProfileId ||
		prior?.styleGuideProfileId ||
		DEFAULT_STYLE_GUIDE_PROFILE_ID;
	await snapshotStyleGuideBundle(id, profileId);

	const phase =
		session.phase ||
		(fs.existsSync(paths.classification) && fs.existsSync(paths.findings) ? 'refine' : 'classify');

	/** @type {Partial<AnalysisMeta>} */
	const patch = {
		phase,
		usingDefaults: Boolean(session.usingDefaults),
		styleGuideProfileId: profileId,
		hasStyleGuideSnapshot: fs.existsSync(paths.styleGuideJson),
		...(session.name ? { name: session.name } : {}),
	};
	if (session.screen === 'home' || session.screen === 'classify' || session.screen === 'refine') {
		patch.screen = session.screen;
	}
	if (
		session.refineScreen === 'image' ||
		session.refineScreen === 'database' ||
		session.refineScreen === 'legend'
	) {
		patch.refineScreen = session.refineScreen;
	}
	const priorMax =
		typeof session.maxUnlockedTier === 'number' && session.maxUnlockedTier >= 1
			? session.maxUnlockedTier
			: prior?.maxUnlockedTier;
	const resolved = resolveActiveTierToTest(session.tierToTest, priorMax, {
		usingDefaults: prior?.usingDefaults ?? session.usingDefaults,
	});
	patch.tierToTest = resolved.tierToTest;
	patch.maxUnlockedTier = resolved.maxUnlockedTier;

	return updateAnalysisMeta(id, patch);
}

/**
 * Restore an analysis into the live pipeline paths and return session pointers.
 * @param {string} id
 * @returns {Promise<{
 *   cutawayPath: string,
 *   legendPath: string,
 *   usingDefaults: boolean,
 *   analysisId: string,
 *   phase: string,
 *   screen: string,
 *   refineScreen: string,
 *   tierToTest: number,
 *   styleGuideProfileId: string | null,
 *   maxUnlockedTier: number,
 *   updatedAt: string,
 * }>}
 */
export async function restoreAnalysis(id) {
	const paths = analysisPaths(id);
	const meta = await getAnalysisMeta(id);
	if (!meta || !fs.existsSync(paths.cutaway) || !fs.existsSync(paths.legend)) {
		throw new Error(`Analysis ${id} is missing images`);
	}

	// Claim the live lease before any copy so a snapshot for the analysis we are
	// leaving cannot capture this analysis's freshly restored state.
	await setLiveOwnerId(id);

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
	await restoreLegendItems(paths.legendItems);
	await restoreFreehandIcons(paths.freehandIcons);
	await restoreRlFeedback(paths);

	const maxUnlocked =
		typeof meta.maxUnlockedTier === 'number' && meta.maxUnlockedTier >= 1
			? meta.maxUnlockedTier
			: meta.usingDefaults
				? 3
				: 1;
	const { maxUnlockedTier, tierToTest } = resolveActiveTierToTest(
		meta.tierToTest,
		maxUnlocked,
		{ usingDefaults: meta.usingDefaults },
	);
	const phase = meta.phase === 'classify' ? 'classify' : 'refine';
	const screen =
		meta.screen === 'home' || meta.screen === 'classify' || meta.screen === 'refine'
			? meta.screen
			: phase;
	const refineScreen =
		meta.refineScreen === 'database' || meta.refineScreen === 'legend'
			? meta.refineScreen
			: 'image';

	// Persist healed focus when meta lagged behind the unlock gate.
	if (meta.tierToTest !== tierToTest || meta.maxUnlockedTier !== maxUnlockedTier) {
		await updateAnalysisMeta(id, { tierToTest, maxUnlockedTier });
	}

	return {
		// Read straight from the analysis folder — no shared working copies.
		cutawayPath: paths.cutaway,
		legendPath: paths.legend,
		usingDefaults: Boolean(meta.usingDefaults),
		analysisId: id,
		phase,
		screen: screen === 'home' ? phase : screen,
		refineScreen,
		tierToTest,
		styleGuideProfileId: meta.styleGuideProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID,
		maxUnlockedTier,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Write uploaded images into an analysis folder (the only copy the lab uses).
 * @param {string} id
 * @param {{cutaway?: Buffer, legend?: Buffer}} files
 * @returns {Promise<{cutawayPath: string, legendPath: string}>}
 */
export async function writeAnalysisImages(id, files) {
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });

	if (files.cutaway) await fsp.writeFile(paths.cutaway, files.cutaway);
	if (files.legend) await fsp.writeFile(paths.legend, files.legend);

	await updateAnalysisMeta(id, { usingDefaults: false, phase: 'classify' });
	return { cutawayPath: paths.cutaway, legendPath: paths.legend };
}

/**
 * Resolve the active Tier to Test for an analysis.
 * Progression is gate-based: Mark Tier N Complete sets maxUnlockedTier to N+1 and
 * work continues on that tier. Concurrent UI-state writes can leave tierToTest
 * behind the gate — resume at the unlock gate when stored focus lags.
 *
 * @param {number | null | undefined} storedTier - Persisted tierToTest
 * @param {number | null | undefined} maxUnlockedTier - Unlock gate
 * @param {{ usingDefaults?: boolean }} [opts]
 * @returns {{ maxUnlockedTier: number, tierToTest: number }}
 */
export function resolveActiveTierToTest(storedTier, maxUnlockedTier, opts = {}) {
	const maxUnlocked =
		typeof maxUnlockedTier === 'number' && maxUnlockedTier >= 1
			? Math.min(3, Math.max(1, maxUnlockedTier))
			: opts.usingDefaults
				? 3
				: 1;
	const stored =
		typeof storedTier === 'number' && storedTier >= 1
			? Math.min(3, Math.max(1, storedTier))
			: 1;
	return {
		maxUnlockedTier: maxUnlocked,
		// Prefer stored when it matches the gate; otherwise heal up to the gate.
		tierToTest: stored < maxUnlocked ? maxUnlocked : Math.min(stored, maxUnlocked),
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
	const { maxUnlockedTier, tierToTest } = resolveActiveTierToTest(
		meta.tierToTest,
		meta.maxUnlockedTier,
		{ usingDefaults: meta.usingDefaults },
	);
	return {
		...meta,
		maxUnlockedTier,
		tierToTest,
		refineScreen: meta.refineScreen || 'image',
		screen: meta.screen || meta.phase || 'classify',
		hasCutaway: fs.existsSync(paths.cutaway),
		hasLegend: fs.existsSync(paths.legend),
		hasClassification: fs.existsSync(paths.classification),
		hasFindings: fs.existsSync(paths.findings),
		hasStyleGuideSnapshot: fs.existsSync(paths.styleGuideJson),
		hasRlFeedback: fs.existsSync(paths.rlFeedback),
		hasTrainingFeedback: fs.existsSync(paths.trainingFeedback),
		tier1Found: t1.found ?? null,
		tier1Expected: t1.expected ?? null,
		tier1Instances: t1.instanceTotal ?? null,
		cutawayRel: fs.existsSync(paths.cutaway) ? toRepoRel(paths.cutaway) : null,
		legendRel: fs.existsSync(paths.legend) ? toRepoRel(paths.legend) : null,
		figuresRoot: toRepoRel(FIGURES),
	};
}

/**
 * Permanently delete an analysis folder and remove it from the index.
 * @param {string} id - Analysis id
 * @returns {Promise<{ok: true, id: string}>}
 */
export async function deleteAnalysis(id) {
	if (!id || typeof id !== 'string' || id.includes('..') || id.includes('/') || id.includes('\\')) {
		throw new Error('invalid analysis id');
	}
	await ensureAnalysesStore();
	const dir = analysisDir(id);
	if (fs.existsSync(dir)) {
		await fsp.rm(dir, { recursive: true, force: true });
	}
	const index = await readIndex();
	index.analyses = index.analyses.filter((a) => a.id !== id);
	await writeIndex(index);
	// Release the lease and scrub live state so the next analysis cannot inherit
	// (or be blamed for) the deleted analysis's pipeline outputs.
	if ((await readLiveOwnerId()) === id) {
		await setLiveOwnerId(null);
		await clearLiveWorkspace();
	}
	return { ok: true, id };
}
