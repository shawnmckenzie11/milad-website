/**
 * Saved image-analysis store for the lung legend lab.
 *
 * Each analysis is a folder under tools/lung-legend-lab/workspace/analyses/{id}/
 * holding cutaway/legend images plus extract, classification, match,
 * findings, annotations, outline layers, legend glyph crops, and a
 * style-guide snapshot (profile JSON/MD + synthesized legend context).
 *
 * That folder is the **store of record**: the API reads and writes it directly
 * and the Python steps receive it as `--io-root`. There is no shared live tree
 * to lease, flush or clear, so opening a second analysis in the UI cannot
 * disturb work in progress on the first one.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	WORKSPACE,
	LEGACY_LIVE_OWNER_PATH,
	EXTRACT_JSON,
	CLASSIFICATION_JSON,
	FINDINGS_DB,
	MATCH_REPORT,
	ANNOTATIONS_JSON,
	TRAINING_FEEDBACK_JSON,
	FREEHAND_ICONS_DIR,
	FIGURES,
	SITE_STORE,
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
		analysisId: id,
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
		// Matcher working dirs; kept per analysis so two runs never share glyph
		// templates, previews or verify composites. Mirrors lung_io_paths.py.
		templates: path.join(root, 'templates'),
		previews: path.join(root, 'previews'),
		debug: path.join(root, 'debug'),
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
 * Resolve the store a request or job must operate on.
 *
 * Passing an explicit id is the supported way for a job to keep writing its own
 * analysis after the operator opens another one; `null` means "defaults mode"
 * (no analysis bound) and resolves to the published site tree.
 *
 * @param {string | null | undefined} analysisId
 * @returns {ReturnType<typeof analysisPaths> | typeof SITE_STORE}
 */
export function storeFor(analysisId) {
	return analysisId ? analysisPaths(analysisId) : SITE_STORE;
}

/**
 * Ensure the per-analysis working directories exist before a job writes them.
 * @param {ReturnType<typeof analysisPaths> | typeof SITE_STORE} store
 * @returns {Promise<void>}
 */
export async function ensureStoreDirs(store) {
	for (const dir of [store.root, store.layers, store.legendItems, store.freehandIcons, store.debug]) {
		if (dir) await fsp.mkdir(dir, { recursive: true });
	}
}

/**
 * Fold a pre-lease-removal workspace into per-analysis stores, then drop the
 * lease file.
 *
 * Older builds kept the *only* copy of some in-flight state in the shared
 * `workspace/` + `public/figures` tree and snapshotted it into the lease holder
 * later. Files are imported only when the analysis has none of its own, so a
 * stale shared file can never overwrite saved per-analysis data.
 *
 * @returns {Promise<{owner: string | null, imported: string[]}>}
 */
export async function migrateLegacyLiveWorkspace() {
	if (!fs.existsSync(LEGACY_LIVE_OWNER_PATH)) return { owner: null, imported: [] };
	let owner = null;
	try {
		const raw = JSON.parse(await fsp.readFile(LEGACY_LIVE_OWNER_PATH, 'utf8'));
		owner = typeof raw.analysisId === 'string' && raw.analysisId ? raw.analysisId : null;
	} catch {
		owner = null;
	}
	const imported = [];
	if (owner && fs.existsSync(analysisPaths(owner).meta)) {
		const paths = analysisPaths(owner);
		/** @type {Array<[string, string, string]>} live path, analysis path, label */
		const candidates = [
			[EXTRACT_JSON, paths.extract, 'legend-extract.json'],
			[CLASSIFICATION_JSON, paths.classification, 'legend-classification.json'],
			[FINDINGS_DB, paths.findings, 'legend-findings-db.json'],
			[MATCH_REPORT, paths.matchReport, 'template-match-report.json'],
			[ANNOTATIONS_JSON, paths.annotations, 'lab-annotations.json'],
			[TRAINING_FEEDBACK_JSON, paths.trainingFeedback, 'lab-training-feedback.json'],
			[RL_FEEDBACK_JSON, paths.rlFeedback, 'rl-feedback.json'],
			[RL_FEEDBACK_MD, paths.rlFeedbackMd, 'rl-feedback-prompt.md'],
		];
		for (const [from, to, label] of candidates) {
			if (fs.existsSync(to)) continue;
			if (await copyIfExists(from, to)) imported.push(label);
		}
		if ((await copyMissingPngs(FREEHAND_ICONS_DIR, paths.freehandIcons)) > 0) {
			imported.push('freehand-icons/');
		}
	}
	await fsp.rm(LEGACY_LIVE_OWNER_PATH, { force: true });
	// Legacy shared image copies: analyses now point straight at their own files.
	for (const legacy of ['active-cutaway.png', 'active-legend.png']) {
		await fsp.rm(path.join(WORKSPACE, legacy), { force: true });
	}
	return { owner, imported };
}

/**
 * Copy PNGs the destination does not already have, keeping every file the
 * destination owns.
 *
 * Used by the one-time legacy migration, where the analysis's own copy always
 * wins over whatever the retired shared workspace happened to hold.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @returns {Promise<number>} Number of files copied in
 */
async function copyMissingPngs(srcDir, destDir) {
	await fsp.mkdir(destDir, { recursive: true });
	if (!fs.existsSync(srcDir)) return 0;
	let copied = 0;
	for (const name of (await fsp.readdir(srcDir)).filter((n) => n.endsWith('.png'))) {
		const dest = path.join(destDir, name);
		if (fs.existsSync(dest)) continue;
		await fsp.copyFile(path.join(srcDir, name), dest);
		copied += 1;
	}
	return copied;
}

/**
 * Copy PNGs from `srcDir` to `destDir` and drop dest PNGs the source no longer
 * has. Only used when importing an outside store into an analysis; skipped when
 * the source is empty so an import can never wipe a saved analysis.
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
 * Copy PNGs from `srcDir` into `destDir`, optionally limited to `wanted`
 * filenames. Used when *importing* an outside store (the checked-in site tree)
 * into an analysis; copies are additive so an import cannot delete an analysis's
 * own artwork.
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
	return copied;
}

/**
 * Import another store's pipeline artifacts into an analysis folder.
 *
 * Only used for deliberate adoption ("seed from the checked-in figures", "save
 * my defaults-mode work as an analysis"). Never called on analysis switch, so
 * opening one analysis cannot rewrite another's files.
 *
 * @param {string} id - Destination analysis id
 * @param {typeof SITE_STORE | ReturnType<typeof analysisPaths>} from - Source store
 * @returns {Promise<void>}
 */
export async function importStoreIntoAnalysis(id, from) {
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });
	await copyIfExists(from.cutaway, paths.cutaway);
	await copyIfExists(from.legend, paths.legend);
	await copyIfExists(from.extract, paths.extract);
	await copyIfExists(from.classification, paths.classification);
	await copyIfExists(from.findings, paths.findings);
	await copyIfExists(from.matchReport, paths.matchReport);
	await copyIfExists(from.annotations, paths.annotations);
	await copyIfExists(from.trainingFeedback, paths.trainingFeedback);
	await copyIfExists(from.rlFeedback, paths.rlFeedback);
	await copyIfExists(from.rlFeedbackMd, paths.rlFeedbackMd);
	const owned = await analysisOwnedNames(id);
	const layerNames = new Set();
	for (const slug of owned.slugs) {
		layerNames.add(`${slug}.png`);
		layerNames.add(`${slug}-outline.png`);
	}
	const glyphNames = new Set();
	for (const code of owned.codes) {
		glyphNames.add(`${code}-glyph.png`);
		glyphNames.add(`${code}-row.png`);
	}
	await copyPngSubset(from.layers, paths.layers, layerNames.size > 0 ? layerNames : null);
	await copyPngSubset(from.legendItems, paths.legendItems, glyphNames.size > 0 ? glyphNames : null);
	await mirrorPngDir(from.freehandIcons, paths.freehandIcons);
	if (!fs.existsSync(paths.rlFeedbackHistory)) {
		await fsp.writeFile(paths.rlFeedbackHistory, JSON.stringify({ entries: [] }, null, 2), 'utf8');
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

	await importStoreIntoAnalysis(id, SITE_STORE);
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
 * Persist session state for one analysis (meta + style-guide/legend context).
 *
 * The analysis's databases are written in place by the API and the pipeline, so
 * this no longer copies pipeline artifacts anywhere and no longer consults a
 * lease. It is safe to call for analysis A while the operator is looking at
 * analysis B: every path it touches is inside A's own folder.
 *
 * @param {string} id
 * @param {{
 *   cutawayPath?: string,
 *   legendPath?: string,
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
export async function saveAnalysisSession(id, session) {
	const paths = analysisPaths(id);
	await fsp.mkdir(paths.root, { recursive: true });
	// Adopt images that still live outside the folder (defaults / legacy sessions).
	if (session.cutawayPath) await copyIfExists(session.cutawayPath, paths.cutaway);
	if (session.legendPath) await copyIfExists(session.legendPath, paths.legend);

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
 * Open an analysis: validate it, heal its resume state, return session pointers.
 *
 * Opening is a **read** of the target analysis and a pointer change in
 * `session.json`. Nothing is copied into or out of a shared tree, so opening
 * analysis B while a job or agent is working on analysis A leaves every one of
 * A's files untouched.
 *
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
export async function openAnalysis(id) {
	const paths = analysisPaths(id);
	const meta = await getAnalysisMeta(id);
	if (!meta || !fs.existsSync(paths.cutaway) || !fs.existsSync(paths.legend)) {
		throw new Error(`Analysis ${id} is missing images`);
	}
	await ensureStoreDirs(paths);
	if (!fs.existsSync(paths.trainingFeedback)) {
		await fsp.writeFile(
			paths.trainingFeedback,
			JSON.stringify({ feedback: [] }, null, 2),
			'utf8',
		);
	}

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
		// The analysis folder is the store of record — no shared working copies.
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
	// Nothing else to scrub: this analysis's databases lived only in its folder,
	// and no other analysis shared them.
	return { ok: true, id };
}
