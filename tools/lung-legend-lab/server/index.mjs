/**
 * Local maintainer API for the lung legend lab UI.
 *
 * Wraps existing Python scripts (extract / classify / generate / findings)
 * and serves cutaway assets, findings DB, and instance annotations.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	ROOT,
	WORKSPACE,
	SESSION_PATH,
	DEFAULT_CUTAWAY,
	DEFAULT_LEGEND,
	SITE_STORE,
	LAYERS_DIR,
	DEBUG_DIR,
	FIGURES,
	RUN_LUNG_PYTHON,
	OBSERVABILITY_PY,
	TEMPLATE_MATCH_PY,
	FINDINGS_DB_PY,
	toRepoRel,
} from './paths.mjs';
import { createJob, getJob, runProcessJob, serializeJob } from './jobs.mjs';
import {
	ensureAnalysesStore,
	listAnalyses,
	summarizeAnalysis,
	createAnalysis,
	saveAnalysisSession,
	openAnalysis,
	writeAnalysisImages,
	updateAnalysisMeta,
	getAnalysisMeta,
	seedCurrentAnalysis,
	deleteAnalysis,
	loadAnalysisStyleGuideBrief,
	appendRlFeedbackHistory,
	analysisPaths,
	resolveActiveTierToTest,
	storeFor,
	ensureStoreDirs,
	importStoreIntoAnalysis,
	migrateLegacyLiveWorkspace,
} from './analyses.mjs';
import { reconcileFreehandWithMatches } from './freehandMatchReconcile.mjs';
import {
	DEFAULT_STYLE_GUIDE_PROFILE_ID,
	createStyleGuideProfile,
	getStyleGuideProfileBrief,
	listStyleGuideProfileSummaries,
	loadStyleGuideProfile,
	resolveStyleGuideProfileId,
	updateStyleGuideProfile,
} from './styleGuides.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.LUNG_LAB_PORT || 8789);

const SUB_TIERS = [
	'exact-replica',
	'exact-replica-absent',
	'explicitly-present',
	'partial-neighbor-similarity',
	'fractal-scale-continuation',
	'scale-divergent-low-similarity',
	'not-diagrammed-in-legend',
	'absent-from-figure',
];

const ICON_INTERPS = ['1-discrete', '2-discrete', 'multiple-adjacent-as-one'];

/** Stable layer slugs for the current checked-in legend (fill when wizard leaves slug empty). */
const KNOWN_LAYER_SLUGS = {
	A1: 'trachea-conducting-airway',
	A2: 'bronchial-branches',
	A3: 'alveolar-fields',
	A4: 'airway-lumen',
	B1: 'airway-epithelium',
	B2: 'airway-immune-compartment',
	B3: 'neutrophils',
	B4: 'alveolar-macrophages',
	B5: 'dendritic-cells',
	B6: 'antiviral-immune-mediators',
	B7: 'inflammatory-signaling',
	B8: 'copd-inflammatory-structures',
	B9: 'infection-antiviral-pathway',
};

/**
 * Ensure a classification row has a non-empty layer slug when one is known.
 * @param {string} code
 * @param {Record<string, unknown>} cls
 * @returns {Record<string, unknown>}
 */
function withKnownSlug(code, cls) {
	const slug = typeof cls.slug === 'string' ? cls.slug.trim() : '';
	if (slug) return { ...cls, slug };
	const known = KNOWN_LAYER_SLUGS[code];
	return known ? { ...cls, slug: known } : cls;
}

/** True once the legacy-workspace migration has run for this process. */
let legacyWorkspaceMigrated = false;

/**
 * Ensure workspace + analyses store exist.
 * First launch (no session.json) seeds the checked-in cutaway analysis.
 * An explicit empty home (`analysisId: null`) stays empty — do not re-seed,
 * or deleting the last / "current" analysis can never stick.
 * @returns {Promise<void>}
 */
async function ensureWorkspace() {
	await fsp.mkdir(WORKSPACE, { recursive: true });
	await ensureAnalysesStore();
	if (!legacyWorkspaceMigrated) {
		legacyWorkspaceMigrated = true;
		const migrated = await migrateLegacyLiveWorkspace();
		if (migrated.owner) {
			const detail = migrated.imported.length > 0 ? migrated.imported.join(', ') : 'nothing to import';
			console.log(`· Retired live lease held by ${migrated.owner} (${detail})`);
		}
	}
	if (!fs.existsSync(SESSION_PATH)) {
		const seeded = await seedCurrentAnalysis();
		const opened = await openAndReconcile(seeded.id);
		await writeSession({
			...opened,
			screen: 'refine',
			phase: 'refine',
		});
		return;
	}
	await adoptLegacySession();
}

/**
 * Repoint a legacy session's image paths at the bound analysis's own files.
 * Older builds pointed the session at shared `workspace/active-*.png` copies.
 * @returns {Promise<void>}
 */
async function adoptLegacySession() {
	const raw = await loadJson(SESSION_PATH);
	const id = typeof raw?.analysisId === 'string' ? raw.analysisId : null;
	if (!id) return;
	const paths = analysisPaths(id);
	if (
		fs.existsSync(paths.cutaway) &&
		fs.existsSync(paths.legend) &&
		(raw.cutawayPath !== paths.cutaway || raw.legendPath !== paths.legend)
	) {
		await fsp.writeFile(
			SESSION_PATH,
			JSON.stringify(
				{ ...raw, cutawayPath: paths.cutaway, legendPath: paths.legend },
				null,
				2,
			),
			'utf8',
		);
	}
}

/**
 * Read the active session (cutaway/legend pointers + analysis binding).
 * @returns {Promise<object>}
 */
async function readSession() {
	await ensureWorkspace();
	const raw = JSON.parse(await fsp.readFile(SESSION_PATH, 'utf8'));
	return {
		cutawayPath: raw.cutawayPath || DEFAULT_CUTAWAY,
		legendPath: raw.legendPath || DEFAULT_LEGEND,
		usingDefaults: Boolean(raw.usingDefaults),
		analysisId: raw.analysisId || null,
		phase: raw.phase || 'refine',
		screen: raw.screen || (raw.analysisId ? raw.phase || 'refine' : 'home'),
		refineScreen:
			raw.refineScreen === 'database' || raw.refineScreen === 'legend'
				? raw.refineScreen
				: 'image',
		tierToTest:
			typeof raw.tierToTest === 'number' && raw.tierToTest >= 1
				? Math.min(3, raw.tierToTest)
				: 1,
		updatedAt: raw.updatedAt || new Date().toISOString(),
	};
}

/**
 * Resolve the store the current request should read and write.
 *
 * Requests from the UI act on the analysis the session is viewing; with no
 * analysis bound (defaults mode) they act on the checked-in site tree.
 *
 * @returns {Promise<{store: ReturnType<typeof analysisPaths> | typeof SITE_STORE, session: object}>}
 */
async function activeStore() {
	const session = await readSession();
	const store = storeFor(session.analysisId);
	await ensureStoreDirs(store);
	return { store, session };
}

/**
 * Persist session/meta state for the analysis the session is viewing.
 *
 * Only touches that analysis's own folder, so it can never overwrite another
 * analysis's databases.
 *
 * @returns {Promise<object | null>}
 */
async function saveActiveSessionMeta() {
	const session = await readSession();
	if (!session.analysisId) return null;
	const meta = await getAnalysisMeta(session.analysisId);
	return saveAnalysisSession(session.analysisId, {
		cutawayPath: session.cutawayPath,
		legendPath: session.legendPath,
		usingDefaults: session.usingDefaults,
		phase: session.phase === 'classify' ? 'classify' : 'refine',
		screen: session.screen,
		refineScreen: session.refineScreen,
		tierToTest: session.tierToTest,
		styleGuideProfileId: meta?.styleGuideProfileId || null,
		maxUnlockedTier: meta?.maxUnlockedTier,
	});
}

/**
 * Record a finished pipeline job against the analysis it was started for.
 *
 * The job wrote into that analysis's own folder (`--io-root`), so this runs
 * unconditionally — switching analyses mid-job no longer discards the result,
 * which was the old failure mode ("snapshot skipped: analysis changed").
 *
 * @param {string | null} startedForId - Analysis id captured when the job began
 * @param {import('./jobs.mjs').Job} job - Job whose log records the outcome
 * @returns {Promise<void>}
 */
async function recordJobForAnalysis(startedForId, job) {
	if (!startedForId) return;
	try {
		const meta = await getAnalysisMeta(startedForId);
		await saveAnalysisSession(startedForId, {
			styleGuideProfileId: meta?.styleGuideProfileId || null,
			maxUnlockedTier: meta?.maxUnlockedTier,
			tierToTest: meta?.tierToTest,
			usingDefaults: meta?.usingDefaults,
		});
		job.log.push(`· Results saved to analysis ${startedForId}`);
	} catch (err) {
		job.log.push(`· Save warn: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Python `--io-root` args for a job, or none in defaults mode.
 * @param {string | null} analysisId - Analysis the job runs for
 * @returns {string[]}
 */
function ioRootArgs(analysisId) {
	return analysisId ? ['--io-root', analysisPaths(analysisId).root] : [];
}

/**
 * Whether an analysis exists but has no uploaded images yet (still in the wizard).
 * @param {string} id - Analysis id
 * @returns {Promise<boolean>}
 */
async function analysisNeedsImages(id) {
	if (!(await getAnalysisMeta(id))) return false;
	const paths = analysisPaths(id);
	return !fs.existsSync(paths.cutaway) || !fs.existsSync(paths.legend);
}

/**
 * Open an analysis, then heal stale freehand↔match duplicates inside it.
 * Reconcile runs even without a rematch so opening an older analysis cannot
 * leave both a freehand and a compatible/incompatible hit visible in the DB.
 *
 * @param {string} id - Analysis id
 * @returns {Promise<object>} Session pointers from `openAnalysis`
 */
async function openAndReconcile(id) {
	const opened = await openAnalysis(id);
	try {
		const reconciled = await reconcileFreehandWithMatches({ analysisId: id });
		if (
			reconciled.supersededFreehands.length > 0 ||
			reconciled.rejectedMatches.length > 0
		) {
			await saveAnalysisSession(id, {
				usingDefaults: opened.usingDefaults,
				phase: opened.phase === 'classify' ? 'classify' : 'refine',
				screen: opened.screen,
				refineScreen: opened.refineScreen,
				tierToTest: opened.tierToTest,
				styleGuideProfileId: opened.styleGuideProfileId || null,
				maxUnlockedTier: opened.maxUnlockedTier,
			});
		}
	} catch (err) {
		console.warn(
			'[lung-lab] freehand reconcile on open:',
			err instanceof Error ? err.message : String(err),
		);
	}
	return opened;
}

/**
 * Persist session pointers.
 * @param {object} session
 * @returns {Promise<object>}
 */
async function writeSession(session) {
	await fsp.mkdir(WORKSPACE, { recursive: true });
	await fsp.writeFile(SESSION_PATH, JSON.stringify(session, null, 2), 'utf8');
	return session;
}

/**
 * Load JSON from disk or return null.
 * @param {string} filePath
 * @returns {Promise<object | null>}
 */
async function loadJson(filePath) {
	try {
		const text = await fsp.readFile(filePath, 'utf8');
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Write JSON atomically-ish (write then rename not needed for local lab).
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function saveJson(filePath, data) {
	await fsp.mkdir(path.dirname(filePath), { recursive: true });
	await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Whether two hit centers match within purge tolerance (~1.5px).
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {boolean}
 */
function centersNear(ax, ay, bx, by) {
	return Math.abs(ax - bx) < 1.5 && Math.abs(ay - by) < 1.5;
}

/**
 * Append an FP event to training feedback if no matching archive entry exists.
 * Historical FPs stay here for RL delta prompts; they are not active review items.
 *
 * @param {object[]} feedbackList - Mutable training feedback array
 * @param {{ id?: string, code: string, cx: number, cy: number, note?: string, updatedAt?: string }} ann
 * @param {string} createdAt - ISO timestamp for the archive row
 * @returns {boolean} True when a new feedback row was pushed
 */
function ensureFpFeedbackEntry(feedbackList, ann, createdAt) {
	const already = feedbackList.some(
		(f) =>
			f.kind === 'false-positive' &&
			f.code === ann.code &&
			f.from &&
			centersNear(f.from.cx, f.from.cy, ann.cx, ann.cy),
	);
	if (already) return false;
	feedbackList.push({
		id: `ann-fp-archive-${ann.id || `${ann.code}:${ann.cx}:${ann.cy}`}-${Date.now()}`,
		code: ann.code,
		kind: 'false-positive',
		from: { cx: ann.cx, cy: ann.cy },
		to: null,
		points: null,
		note: ann.note || '',
		createdAt,
	});
	return true;
}

/**
 * Remove a match instance near (cx, cy) from the findings DB item, updating counts.
 * @param {object | null} findings
 * @param {string} code
 * @param {number} cx
 * @param {number} cy
 * @returns {{ findings: object, removed: boolean }}
 */
function removeFindingInstance(findings, code, cx, cy) {
	const next = findings && typeof findings === 'object' ? structuredClone(findings) : { items: {} };
	if (!next.items || typeof next.items !== 'object') next.items = {};
	const item = next.items[code];
	if (!item || !Array.isArray(item.instances)) {
		return { findings: next, removed: false };
	}
	const before = item.instances.length;
	item.instances = item.instances.filter(
		(inst) => !centersNear(inst?.cx ?? 0, inst?.cy ?? 0, cx, cy),
	);
	const removed = item.instances.length < before;
	if (removed) {
		item.instanceCount = item.instances.length;
		const scores = item.instances
			.map((inst) => inst?.score)
			.filter((s) => typeof s === 'number');
		item.bestScore = scores.length > 0 ? Math.max(...scores) : null;
		if (item.instances.length === 0) {
			item.status = item.status === 'found' ? 'missed' : item.status;
		}
	}
	return { findings: next, removed };
}

/**
 * Drop annotations and training-feedback rows that refer to a match center.
 * Keeps any existing `deleted` markers; caller may append a fresh one.
 *
 * @param {object[]} annotationsList
 * @param {object[]} feedbackList
 * @param {string} code
 * @param {number} cx
 * @param {number} cy
 * @returns {{ annotations: object[], feedback: object[], removedAnn: number, removedFb: number }}
 */
function scrubHitReviewData(annotationsList, feedbackList, code, cx, cy) {
	let removedAnn = 0;
	let removedFb = 0;
	const annotations = annotationsList.filter((a) => {
		if (a?.code !== code) return true;
		if (!centersNear(a.cx ?? 0, a.cy ?? 0, cx, cy)) return true;
		removedAnn += 1;
		return false;
	});
	const feedback = feedbackList.filter((f) => {
		if (f?.kind === 'deleted' || f?.kind === 'deleted-code') return true;
		if (f?.kind === 'freehand-classify') return true;
		if (f?.code !== code) return true;
		const fx = f.from?.cx;
		const fy = f.from?.cy;
		if (fx == null || fy == null) return true;
		if (!centersNear(fx, fy, cx, cy)) return true;
		removedFb += 1;
		return false;
	});
	return { annotations, feedback, removedAnn, removedFb };
}

/**
 * Move false-positive annotations out of the active review store into the
 * training-feedback archive, then persist both files when anything changed.
 *
 * Active annotations keep only confirmed / reassigned (and other non-FP labels).
 * FP coords remain in `lab-training-feedback.json` for Generate Feedback Prompt.
 *
 * @param {{annotations: string, trainingFeedback: string}} store - Store to migrate
 * @returns {Promise<{ annotations: object, trainingFeedback: object, purgedCount: number }>}
 */
async function migrateFalsePositivesOutOfActiveStore(store) {
	const existingAnn = (await loadJson(store.annotations)) || { annotations: [] };
	const existingFb = (await loadJson(store.trainingFeedback)) || { feedback: [] };
	const list = Array.isArray(existingAnn.annotations) ? [...existingAnn.annotations] : [];
	const feedbackList = Array.isArray(existingFb.feedback) ? [...existingFb.feedback] : [];

	const kept = [];
	let purgedCount = 0;
	const now = new Date().toISOString();
	for (const ann of list) {
		if (ann?.label !== 'false-positive') {
			kept.push(ann);
			continue;
		}
		purgedCount += 1;
		ensureFpFeedbackEntry(feedbackList, ann, ann.updatedAt || now);
	}

	const annotations = {
		annotations: kept,
		updatedAt: purgedCount > 0 ? now : existingAnn.updatedAt || now,
	};
	const trainingFeedback = {
		feedback: feedbackList,
		updatedAt: purgedCount > 0 ? now : existingFb.updatedAt || now,
	};

	if (purgedCount > 0) {
		await saveJson(store.annotations, annotations);
		await saveJson(store.trainingFeedback, trainingFeedback);
	}

	return { annotations, trainingFeedback, purgedCount };
}

/**
 * Read request body as a Buffer.
 * @param {http.IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit = 40 * 1024 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error('Payload too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/**
 * Parse a multipart/form-data body with one or more file parts (no deps).
 * @param {Buffer} body
 * @param {string} contentType
 * @returns {{fields: Record<string, string>, files: Record<string, {filename: string, data: Buffer}>}}
 */
function parseMultipart(body, contentType) {
	const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
	if (!m) throw new Error('Missing multipart boundary');
	const boundary = m[1] || m[2];
	const delim = Buffer.from(`--${boundary}`);
	const fields = {};
	const files = {};

	let start = body.indexOf(delim) + delim.length;
	while (start < body.length) {
		if (body[start] === 45 && body[start + 1] === 45) break; // --
		if (body[start] === 13 && body[start + 1] === 10) start += 2;

		const next = body.indexOf(delim, start);
		const part = body.subarray(start, next === -1 ? body.length : next - 2);
		const headerEnd = part.indexOf('\r\n\r\n');
		if (headerEnd === -1) break;
		const headerText = part.subarray(0, headerEnd).toString('utf8');
		const data = part.subarray(headerEnd + 4);
		const nameMatch = /name="([^"]+)"/i.exec(headerText);
		const fileMatch = /filename="([^"]*)"/i.exec(headerText);
		const name = nameMatch?.[1];
		if (!name) {
			start = next === -1 ? body.length : next + delim.length;
			continue;
		}
		if (fileMatch && fileMatch[1]) {
			files[name] = { filename: fileMatch[1], data };
		} else {
			fields[name] = data.toString('utf8');
		}
		start = next === -1 ? body.length : next + delim.length;
	}
	return { fields, files };
}

/**
 * Send a JSON response with CORS-friendly local headers.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
	// Escape control chars that some runtimes leave unescaped in nested strings.
	const body = JSON.stringify(payload, (_key, value) => {
		if (typeof value === 'string') {
			return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
		}
		return value;
	});
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	});
	res.end(body);
}

/**
 * Stream a file if it exists.
 * @param {http.ServerResponse} res
 * @param {string} filePath
 * @param {string} contentType
 */
async function sendFile(res, filePath, contentType) {
	try {
		const data = await fsp.readFile(filePath);
		res.writeHead(200, {
			'Content-Type': contentType,
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*',
		});
		res.end(data);
	} catch {
		sendJson(res, 404, { error: `Missing file: ${filePath}` });
	}
}

/**
 * Infer content type from extension.
 * @param {string} filePath
 * @returns {string}
 */
function contentTypeFor(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === '.png') return 'image/png';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.svg') return 'image/svg+xml';
	if (ext === '.json') return 'application/json';
	return 'application/octet-stream';
}

/**
 * Sync-run a lung Python script and return stdout/stderr/status.
 * @param {string[]} scriptArgs
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runLungPythonSync(scriptArgs) {
	const result = spawnSync(process.execPath, [RUN_LUNG_PYTHON, ...scriptArgs], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout || '',
		stderr: result.stderr || '',
	};
}

/**
 * Build the combined lab state payload for the UI bootstrap.
 * @returns {Promise<object>}
 */
async function buildState() {
	const { store, session } = await activeStore();
	// Purge already-classified FPs from active annotations into the RL archive.
	const migrated = await migrateFalsePositivesOutOfActiveStore(store);
	const [extract, classification, findings, matchReport, rlFeedback] = await Promise.all([
		loadJson(store.extract),
		loadJson(store.classification),
		loadJson(store.findings),
		loadJson(store.matchReport),
		loadJson(store.rlFeedback),
	]);
	const annotations = migrated.annotations;
	const trainingFeedback = migrated.trainingFeedback;

	// Outlines come from this analysis's own layers dir; the site layers dir holds
	// published artwork that belongs to no analysis.
	const outlineSlugs = [];
	try {
		for (const name of await fsp.readdir(store.layers)) {
			if (name.endsWith('-outline.png')) {
				outlineSlugs.push(name.replace(/-outline\.png$/, ''));
			}
		}
	} catch {
		/* empty */
	}

	const analysisMeta = session.analysisId ? await getAnalysisMeta(session.analysisId) : null;
	const analyses = await Promise.all((await listAnalyses()).map((m) => summarizeAnalysis(m)));
	const styleGuideProfileId = await resolveStyleGuideProfileId(
		analysisMeta?.styleGuideProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID,
	);
	const styleGuideProfiles = await listStyleGuideProfileSummaries();
	const styleGuideProfile = session.analysisId
		? (await loadAnalysisStyleGuideBrief(session.analysisId)) ||
			(await getStyleGuideProfileBrief(styleGuideProfileId))
		: await getStyleGuideProfileBrief(styleGuideProfileId);

	const maxUnlockedTier =
		typeof analysisMeta?.maxUnlockedTier === 'number' && analysisMeta.maxUnlockedTier >= 1
			? analysisMeta.maxUnlockedTier
			: 1;
	const storedTier =
		typeof session.tierToTest === 'number' && session.tierToTest >= 1
			? session.tierToTest
			: typeof analysisMeta?.tierToTest === 'number'
				? analysisMeta.tierToTest
				: 1;
	const resolvedTier = resolveActiveTierToTest(storedTier, maxUnlockedTier, {
		usingDefaults: analysisMeta?.usingDefaults,
	});
	const tierToTest = resolvedTier.tierToTest;
	const refineScreen =
		session.refineScreen === 'database' || session.refineScreen === 'legend'
			? session.refineScreen
			: analysisMeta?.refineScreen === 'database' || analysisMeta?.refineScreen === 'legend'
				? analysisMeta.refineScreen
				: 'image';

	return {
		ok: true,
		maintainerOnly: true,
		analysis: session.analysisId
			? describeAnalysisContext(session.analysisId, analysisMeta)
			: null,
		session: {
			...session,
			cutawayRel: toRepoRel(session.cutawayPath),
			legendRel: toRepoRel(session.legendPath),
			cutawayExists: fs.existsSync(session.cutawayPath),
			legendExists: fs.existsSync(session.legendPath),
			analysisName: analysisMeta?.name || null,
			styleGuideProfileId,
			maxUnlockedTier: resolvedTier.maxUnlockedTier,
			tierToTest,
			refineScreen,
		},
		analyses,
		styleGuideProfiles,
		styleGuideProfile,
		defaults: {
			cutaway: toRepoRel(DEFAULT_CUTAWAY),
			legend: toRepoRel(DEFAULT_LEGEND),
		},
		enums: {
			subTiers: SUB_TIERS,
			iconInterpretations: ICON_INTERPS,
			pathways: ['all', 'cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
		},
		outlineSlugs: outlineSlugs.sort(),
		extract,
		classification,
		findings,
		matchReport,
		annotations: annotations || { annotations: [] },
		trainingFeedback: trainingFeedback || { feedback: [] },
		rlCursor: rlFeedback?.cursor || null,
		// Where this view's data actually lives. With an analysis open these are
		// its own files; with none open they are the published site figures.
		paths: {
			extract: toRepoRel(store.extract),
			classification: toRepoRel(store.classification),
			findings: toRepoRel(store.findings),
			matchReport: toRepoRel(store.matchReport),
			annotations: toRepoRel(store.annotations),
			trainingFeedback: toRepoRel(store.trainingFeedback),
		},
	};
}

/**
 * Analysis-scoped locations an agent should read and write for one analysis.
 *
 * Everything here lives under `workspace/analyses/{id}/` and is the store of
 * record, so a prompt built from it stays correct — and stays writable — after
 * the owner opens a different analysis in the UI.
 *
 * @param {string} id - Analysis id
 * @param {object | null} meta - Analysis meta.json contents
 * @returns {object}
 */
function describeAnalysisContext(id, meta) {
	const p = analysisPaths(id);
	return {
		id,
		name: meta?.name || id,
		dirRel: toRepoRel(p.root),
		usingDefaults: Boolean(meta?.usingDefaults),
		styleGuideProfileId: meta?.styleGuideProfileId || null,
		// How an agent or CLI targets this analysis instead of "whatever is open".
		ioRootRel: toRepoRel(p.root),
		generateCommand: `npm run lung:generate -- --analysis ${id}`,
		paths: {
			cutaway: toRepoRel(p.cutaway),
			legend: toRepoRel(p.legend),
			matchReport: toRepoRel(p.matchReport),
			findings: toRepoRel(p.findings),
			annotations: toRepoRel(p.annotations),
			trainingFeedback: toRepoRel(p.trainingFeedback),
			layers: toRepoRel(p.layers),
			legendItems: toRepoRel(p.legendItems),
			legendContext: toRepoRel(p.legendContext),
			styleGuide: toRepoRel(p.styleGuide),
			rlFeedbackHistory: toRepoRel(p.rlFeedbackHistory),
		},
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
 * Resolve a lab asset from the open analysis's own folder, falling back to the
 * published site dir. Serving per-analysis keeps another analysis's PNGs (which
 * share filenames) out of this session's views.
 *
 * @param {'layers' | 'legendItems' | 'freehandIcons'} bucket - Store subfolder
 * @param {string} fileName - Basename to serve
 * @returns {Promise<string>} Absolute path to serve
 */
async function activeAssetPath(bucket, fileName) {
	const { store } = await activeStore();
	const candidate = path.join(store[bucket], fileName);
	if (fs.existsSync(candidate)) return candidate;
	return path.join(SITE_STORE[bucket], fileName);
}

/**
 * Merge extract fields into a flat legend-item list for the classify panel.
 * @param {object | null} extract
 * @param {object | null} classification
 * @param {object | null} findings
 * @returns {object[]}
 */
function mergeLegendItems(extract, classification, findings) {
	const classes = classification?.classifications || {};
	const findingItems = findings?.items || {};
	const extracted = extract?.items || [];
	const codes = new Set([
		...extracted.map((i) => i.code),
		...Object.keys(classes),
		...Object.keys(findingItems),
	]);
	return [...codes]
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.map((code) => {
			const ex = extracted.find((i) => i.code === code) || {};
			const cls = classes[code] || {};
			const find = findingItems[code] || {};
			return {
				code,
				name: ex.name || find.name || code,
				location: ex.location || '',
				supports: ex.supports || '',
				glyph_path: ex.glyph_path || null,
				row_path: ex.row_path || null,
				tier: cls.tier ?? find.tier ?? null,
				subTier: cls.subTier ?? find.subTier ?? null,
				iconInterpretation: cls.iconInterpretation ?? find.iconInterpretation ?? '1-discrete',
				searchable: cls.searchable ?? find.searchable ?? false,
				group: cls.group ?? find.group ?? null,
				// Empty string from the classify wizard must not block match-report slugs.
				slug: firstNonEmpty(cls.slug, find.slug),
				note: cls.note ?? find.note ?? null,
				assignedPathways: (() => {
					const raw = cls.assignedPathways ?? find.assignedPathways;
					if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
					const single = cls.assignedPathway ?? find.assignedPathway;
					if (typeof single === 'string' && single.trim()) return [single.trim()];
					return [];
				})(),
				assignedPathway: cls.assignedPathway ?? find.assignedPathway ?? null,
				status: find.status ?? null,
				instanceCount: find.instanceCount ?? 0,
				bestScore: find.bestScore ?? null,
				minScore: find.minScore ?? null,
				firstFoundAt: find.firstFoundAt ?? null,
				cumulativeFindCount: find.cumulativeFindCount ?? 0,
				instances: find.instances || [],
			};
		});
}

/**
 * Route handler.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
	const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
	const { pathname } = url;
	const method = req.method || 'GET';

	if (method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		});
		res.end();
		return;
	}

	try {
		if (method === 'GET' && pathname === '/api/health') {
			sendJson(res, 200, { ok: true, service: 'lung-legend-lab', port: PORT });
			return;
		}

		if (method === 'GET' && pathname === '/api/state') {
			sendJson(res, 200, await buildState());
			return;
		}

		if (method === 'GET' && pathname === '/api/items') {
			const { store } = await activeStore();
			const [extract, classification, findings] = await Promise.all([
				loadJson(store.extract),
				loadJson(store.classification),
				loadJson(store.findings),
			]);
			const criteria =
				findings?.criteria ||
				(classification
					? {
							guidelines: classification.guidelines,
							tiers: undefined,
							subTierHelp: classification.subTierHelp,
							iconInterpretationHelp: classification.iconInterpretationHelp,
						}
					: null);
			sendJson(res, 200, {
				items: mergeLegendItems(extract, classification, findings),
				criteria,
				stats: findings?.stats || null,
			});
			return;
		}

		if (method === 'GET' && pathname === '/api/findings') {
			const { store } = await activeStore();
			sendJson(res, 200, (await loadJson(store.findings)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/match-report') {
			const { store } = await activeStore();
			sendJson(res, 200, (await loadJson(store.matchReport)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/extract') {
			const { store } = await activeStore();
			sendJson(res, 200, (await loadJson(store.extract)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/classification') {
			const { store } = await activeStore();
			sendJson(res, 200, (await loadJson(store.classification)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/annotations') {
			const { store } = await activeStore();
			const migrated = await migrateFalsePositivesOutOfActiveStore(store);
			sendJson(res, 200, migrated.annotations);
			return;
		}

		if (method === 'GET' && pathname === '/api/training-feedback') {
			const { store } = await activeStore();
			const migrated = await migrateFalsePositivesOutOfActiveStore(store);
			sendJson(res, 200, migrated.trainingFeedback);
			return;
		}

		if (method === 'GET' && pathname === '/api/assets/cutaway') {
			const session = await readSession();
			await sendFile(res, session.cutawayPath, 'image/png');
			return;
		}

		if (method === 'GET' && pathname === '/api/assets/legend') {
			const session = await readSession();
			await sendFile(res, session.legendPath, 'image/png');
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/assets/outline/')) {
			const slug = decodeURIComponent(pathname.slice('/api/assets/outline/'.length));
			if (!/^[\w-]+$/.test(slug)) {
				sendJson(res, 400, { error: 'invalid slug' });
				return;
			}
			const name = `${slug}-outline.png`;
			await sendFile(res, await activeAssetPath('layers', name), 'image/png');
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/assets/glyph/')) {
			const code = decodeURIComponent(pathname.slice('/api/assets/glyph/'.length));
			// Test 2 legends use A1–A20 (multi-digit). Old /^[AB][1-9]$/ rejected A10+.
			if (!/^[A-Z][1-9]\d{0,2}$/.test(code)) {
				sendJson(res, 400, { error: 'invalid code' });
				return;
			}
			const name = `${code}-glyph.png`;
			await sendFile(res, await activeAssetPath('legendItems', name), 'image/png');
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/assets/freehand-icon/')) {
			const id = decodeURIComponent(pathname.slice('/api/assets/freehand-icon/'.length));
			if (!/^[\w.-]+$/.test(id)) {
				sendJson(res, 400, { error: 'invalid freehand icon id' });
				return;
			}
			const fileName = id.endsWith('.png') ? id : `${id}.png`;
			await sendFile(res, await activeAssetPath('freehandIcons', fileName), 'image/png');
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/assets/file/')) {
			const rel = decodeURIComponent(pathname.slice('/api/assets/file/'.length));
			const abs = path.resolve(ROOT, rel);
			if (!abs.startsWith(FIGURES) && !abs.startsWith(WORKSPACE)) {
				sendJson(res, 403, { error: 'path not allowed' });
				return;
			}
			await sendFile(res, abs, contentTypeFor(abs));
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/jobs/')) {
			const id = pathname.slice('/api/jobs/'.length);
			const job = getJob(id);
			if (!job) {
				sendJson(res, 404, { error: 'job not found' });
				return;
			}
			sendJson(res, 200, serializeJob(job));
			return;
		}

		if (method === 'POST' && pathname === '/api/reset-defaults') {
			// Only unbinds this session's view. The analysis keeps its own files, so
			// there is nothing to flush and nothing another worker can lose.
			await saveActiveSessionMeta();
			const session = await writeSession({
				cutawayPath: DEFAULT_CUTAWAY,
				legendPath: DEFAULT_LEGEND,
				usingDefaults: true,
				analysisId: null,
				phase: 'classify',
				screen: 'home',
				refineScreen: 'image',
				tierToTest: 1,
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 200, { ok: true, session });
			return;
		}

		if (method === 'POST' && pathname === '/api/upload') {
			const body = await readBody(req);
			const { files } = parseMultipart(body, req.headers['content-type'] || '');
			const session = await readSession();
			let cutawayPath = session.cutawayPath;
			let legendPath = session.legendPath;
			let usingDefaults = session.usingDefaults;

			// Bound sessions write into the analysis folder, never a shared copy.
			const target = session.analysisId ? analysisPaths(session.analysisId) : null;
			if (files.cutaway) {
				cutawayPath = target ? target.cutaway : path.join(WORKSPACE, 'active-cutaway.png');
				await fsp.mkdir(path.dirname(cutawayPath), { recursive: true });
				await fsp.writeFile(cutawayPath, files.cutaway.data);
				usingDefaults = false;
			}
			if (files.legend) {
				legendPath = target ? target.legend : path.join(WORKSPACE, 'active-legend.png');
				await fsp.mkdir(path.dirname(legendPath), { recursive: true });
				await fsp.writeFile(legendPath, files.legend.data);
				usingDefaults = false;
			}

			const next = await writeSession({
				...session,
				cutawayPath,
				legendPath,
				usingDefaults,
				updatedAt: new Date().toISOString(),
			});
			if (next.analysisId) {
				await saveAnalysisSession(next.analysisId, {
					cutawayPath,
					legendPath,
					usingDefaults,
					phase: next.phase === 'classify' ? 'classify' : 'refine',
				});
			}
			sendJson(res, 200, {
				ok: true,
				session: {
					...next,
					cutawayRel: toRepoRel(next.cutawayPath),
					legendRel: toRepoRel(next.legendPath),
				},
			});
			return;
		}

		if (method === 'POST' && pathname === '/api/extract') {
			const session = await readSession();
			// Bound at request time: the job keeps writing this analysis even if the
			// operator opens another one before it finishes.
			const startedForId = session.analysisId;
			const job = createJob('extract', {
				legend: toRepoRel(session.legendPath),
				analysisId: startedForId,
			});
			void (async () => {
				await runProcessJob(
					job,
					process.execPath,
					[
						RUN_LUNG_PYTHON,
						OBSERVABILITY_PY,
						'--extract-only',
						'--legend',
						session.legendPath,
						...ioRootArgs(startedForId),
					],
					ROOT,
				);
				if (job.status === 'succeeded') {
					await recordJobForAnalysis(startedForId, job);
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'POST' && pathname === '/api/match') {
			const session = await readSession();
			const startedForId = session.analysisId;
			let body = {};
			try {
				const raw = (await readBody(req, 4 * 1024 * 1024)).toString('utf8');
				body = raw ? JSON.parse(raw) : {};
			} catch {
				body = {};
			}
			const tierToTest = Number(body.tierToTest) || 1;
			const rlSummary = body.rlSummary || null;

			// Persist RL feedback for the next matcher iteration (algorithm mutation stubbed).
			const rlWritten = await writeRlFeedbackArtifacts({
				tierToTest,
				promptMarkdown:
					typeof rlSummary?.promptMarkdown === 'string'
						? rlSummary.promptMarkdown
						: typeof body.promptMarkdown === 'string'
							? body.promptMarkdown
							: '',
				summary: rlSummary || body.summary || { tierToTest },
				analysisId: session.analysisId,
			});

			const job = createJob('match', {
				cutaway: toRepoRel(session.cutawayPath),
				legend: toRepoRel(session.legendPath),
				tierToTest,
				rlFeedback: rlWritten,
				analysisId: startedForId,
			});
			void (async () => {
				job.log.push(`· Tier to Test: ${tierToTest}`);
				if (rlWritten.md) {
					job.log.push(`· RL feedback prompt: ${toRepoRel(rlWritten.md)}`);
				}
				if (rlWritten.json) {
					job.log.push(`· RL feedback JSON: ${toRepoRel(rlWritten.json)}`);
				}
				job.log.push(
					'· Note: matcher algorithm mutation from RL feedback is stubbed; prompt persisted for next iteration.',
				);
				await runProcessJob(
					job,
					process.execPath,
					[
						RUN_LUNG_PYTHON,
						TEMPLATE_MATCH_PY,
						'--generate',
						'--source',
						session.cutawayPath,
						'--legend',
						session.legendPath,
						'--tier-to-test',
						String(tierToTest),
						...ioRootArgs(startedForId),
					],
					ROOT,
				);
				if (job.status === 'succeeded') {
					pushFindingsRefresh(job);
					const findingsJob = createJob('findings', {
						parent: job.id,
						analysisId: startedForId,
					});
					await runProcessJob(
						findingsJob,
						process.execPath,
						[RUN_LUNG_PYTHON, FINDINGS_DB_PY, '--no-canvas', ...ioRootArgs(startedForId)],
						ROOT,
					);
					job.meta.findingsJobId = findingsJob.id;
					job.meta.findingsStatus = findingsJob.status;
					for (const line of findingsJob.log) job.log.push(line);
					try {
						const reconciled = await reconcileFreehandWithMatches({
							analysisId: startedForId,
						});
						for (const line of reconciled.log) job.log.push(line);
						if (reconciled.supersededFreehands.length || reconciled.rejectedMatches.length) {
							job.log.push(
								`· Freehand reconcile: ${reconciled.supersededFreehands.length} superseded, ` +
									`${reconciled.rejectedMatches.length} match(es) rejected`,
							);
						}
					} catch (err) {
						job.log.push(
							`· Freehand reconcile warn: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
					await recordJobForAnalysis(startedForId, job);
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'GET' && pathname === '/api/rl-feedback') {
			const { store } = await activeStore();
			const data = (await loadJson(store.rlFeedback)) || null;
			sendJson(res, 200, {
				ok: true,
				feedback: data,
				cursor: data?.cursor || null,
			});
			return;
		}

		if (method === 'POST' && pathname === '/api/rl-feedback') {
			const session = await readSession();
			const body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}');
			const written = await writeRlFeedbackArtifacts({
				tierToTest: normalizeRlTierScope(body.tierToTest),
				promptMarkdown: String(body.promptMarkdown || ''),
				summary: body.summary || body,
				cursor: body.cursor || null,
				analysisId: session.analysisId,
			});
			sendJson(res, 200, {
				ok: true,
				cursor: body.cursor || null,
				paths: {
					md: toRepoRel(written.md),
					json: toRepoRel(written.json),
				},
			});
			return;
		}

		if (method === 'POST' && pathname === '/api/findings/refresh') {
			const startedForId = (await readSession()).analysisId;
			const job = createJob('findings', { analysisId: startedForId });
			void (async () => {
				await runProcessJob(
					job,
					process.execPath,
					[RUN_LUNG_PYTHON, FINDINGS_DB_PY, '--no-canvas', ...ioRootArgs(startedForId)],
					ROOT,
				);
				if (job.status === 'succeeded') {
					await recordJobForAnalysis(startedForId, job);
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'PUT' && pathname === '/api/classification') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
			const { store, session } = await activeStore();
			const existing = (await loadJson(store.classification)) || {
				source: toRepoRel(session.legendPath || DEFAULT_LEGEND),
				guidelines: '',
				subTierHelp: {},
				iconInterpretationHelp: {},
				classifications: {},
			};
			if (body.classifications && typeof body.classifications === 'object') {
				const merged = {
					...existing.classifications,
					...body.classifications,
				};
				existing.classifications = Object.fromEntries(
					Object.entries(merged).map(([code, cls]) => [
						code,
						withKnownSlug(code, cls && typeof cls === 'object' ? cls : {}),
					]),
				);
			}
			if (typeof body.guidelines === 'string') existing.guidelines = body.guidelines;
			existing.updatedAt = new Date().toISOString();
			existing.updatedBy = 'lung-legend-lab';
			await saveJson(store.classification, existing);

			// Keep findings DB classification fields in sync without a full match rerun.
			const findingsSync = runLungPythonSync([
				FINDINGS_DB_PY,
				'--no-canvas',
				...ioRootArgs(session.analysisId),
			]);
			if (findingsSync.status !== 0) {
				sendJson(res, 500, {
					error: 'classification saved but findings sync failed',
					detail: (findingsSync.stderr || findingsSync.stdout || '').slice(-2000),
				});
				return;
			}
			await saveActiveSessionMeta();
			sendJson(res, 200, { ok: true, classification: existing });
			return;
		}

		if (method === 'PUT' && pathname.startsWith('/api/classification/')) {
			const code = decodeURIComponent(pathname.slice('/api/classification/'.length));
			if (!/^[A-Z][1-9]\d{0,2}$/.test(code)) {
				sendJson(res, 400, { error: 'invalid code' });
				return;
			}
			const patch = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
			const { store, session } = await activeStore();
			const existing = (await loadJson(store.classification)) || {
				source: toRepoRel(session.legendPath || DEFAULT_LEGEND),
				classifications: {},
			};
			const prev = existing.classifications?.[code] || {};
			const next = withKnownSlug(code, {
				...prev,
				...patch,
				tier: patch.tier !== undefined ? Number(patch.tier) : prev.tier,
				searchable:
					patch.searchable !== undefined
						? Boolean(patch.searchable)
						: patch.tier !== undefined
							? Number(patch.tier) > 0
							: prev.searchable,
			});
			if (next.iconInterpretation && !ICON_INTERPS.includes(next.iconInterpretation)) {
				sendJson(res, 400, { error: 'invalid iconInterpretation' });
				return;
			}
			if (next.subTier && !SUB_TIERS.includes(next.subTier)) {
				sendJson(res, 400, { error: 'invalid subTier' });
				return;
			}
			existing.classifications = { ...existing.classifications, [code]: next };
			existing.updatedAt = new Date().toISOString();
			existing.updatedBy = 'lung-legend-lab';
			await saveJson(store.classification, existing);
			const findingsSync = runLungPythonSync([
				FINDINGS_DB_PY,
				'--no-canvas',
				...ioRootArgs(session.analysisId),
			]);
			if (findingsSync.status !== 0) {
				sendJson(res, 500, {
					error: 'classification saved but findings sync failed',
					detail: (findingsSync.stderr || findingsSync.stdout || '').slice(-2000),
				});
				return;
			}
			await saveActiveSessionMeta();
			sendJson(res, 200, { ok: true, code, classification: next });
			return;
		}

		if (method === 'PUT' && pathname === '/api/annotations') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
			const { store } = await activeStore();
			const existing = (await loadJson(store.annotations)) || { annotations: [] };
			const list = Array.isArray(existing.annotations) ? [...existing.annotations] : [];
			const entry = {
				id: body.id || `${body.code}:${body.cx}:${body.cy}`,
				code: body.code,
				cx: body.cx,
				cy: body.cy,
				score: body.score ?? null,
				label: body.label, // confirmed | false-positive | reassigned
				reassignedCode: body.reassignedCode || null,
				locationStatus: body.locationStatus || null,
				note: body.note || '',
				updatedAt: new Date().toISOString(),
			};

			// False positives are archived to training feedback then removed from the
			// active annotation store so they no longer appear as review items.
			if (entry.label === 'false-positive') {
				const fb = (await loadJson(store.trainingFeedback)) || { feedback: [] };
				const feedbackList = Array.isArray(fb.feedback) ? [...fb.feedback] : [];
				ensureFpFeedbackEntry(feedbackList, entry, entry.updatedAt);
				const withoutFp = list.filter(
					(a) =>
						!(
							a.id === entry.id ||
							(a.code === entry.code && centersNear(a.cx, a.cy, entry.cx, entry.cy))
						),
				);
				const next = { annotations: withoutFp, updatedAt: entry.updatedAt };
				const trainingFeedback = {
					feedback: feedbackList,
					updatedAt: entry.updatedAt,
				};
				await saveJson(store.annotations, next);
				await saveJson(store.trainingFeedback, trainingFeedback);
				await saveActiveSessionMeta();
				sendJson(res, 200, {
					ok: true,
					annotations: next,
					trainingFeedback,
					purged: true,
				});
				return;
			}

			const idx = list.findIndex((a) => a.id === entry.id);
			if (idx >= 0) list[idx] = { ...list[idx], ...entry };
			else list.push(entry);
			const next = { annotations: list, updatedAt: entry.updatedAt };
			await saveJson(store.annotations, next);

			// Mirror review labels into training feedback for tier-1 conclusion history.
			const kindMap = {
				confirmed: 'confirmed',
				reassigned: 'reassigned',
			};
			const feedbackKind = kindMap[entry.label];
			if (feedbackKind) {
				const fb = (await loadJson(store.trainingFeedback)) || { feedback: [] };
				const feedbackList = Array.isArray(fb.feedback) ? [...fb.feedback] : [];
				feedbackList.push({
					id: `ann-${entry.id}-${Date.now()}`,
					code: entry.reassignedCode || entry.code,
					kind: feedbackKind,
					from: { cx: entry.cx, cy: entry.cy },
					to: null,
					points: null,
					note: entry.note || '',
					createdAt: entry.updatedAt,
				});
				if (entry.locationStatus) {
					feedbackList.push({
						id: `ann-loc-${entry.id}-${Date.now()}`,
						code: entry.reassignedCode || entry.code,
						kind: entry.locationStatus,
						from: { cx: entry.cx, cy: entry.cy },
						to: null,
						points: null,
						note: entry.note || '',
						createdAt: entry.updatedAt,
					});
				}
				await saveJson(store.trainingFeedback, {
					feedback: feedbackList,
					updatedAt: entry.updatedAt,
				});
			}

			await saveActiveSessionMeta();
			sendJson(res, 200, { ok: true, annotations: next });
			return;
		}

		if (method === 'POST' && pathname === '/api/training-feedback') {
			const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
			const { store } = await activeStore();
			const existing = (await loadJson(store.trainingFeedback)) || { feedback: [] };
			const list = Array.isArray(existing.feedback) ? [...existing.feedback] : [];
			const allowed = new Set([
				'relocate',
				'resize',
				'trace',
				'freehand-classify',
				'false-positive',
				'deleted',
				'deleted-code',
				'confirmed',
				'reassigned',
				'correct-location',
				'wrong-location',
				'pending-miss',
			]);
			if (!body.code || !allowed.has(body.kind)) {
				sendJson(res, 400, { error: 'code and valid kind required' });
				return;
			}
			const createdAt = new Date().toISOString();
			const assignedPathways = Array.isArray(body.assignedPathways)
				? [...new Set(body.assignedPathways.map(String).filter(Boolean))]
				: body.assignedPathway
					? [String(body.assignedPathway)]
					: [];
			const entryId = body.id || `fb-${body.kind}-${body.code}-${Date.now()}`;
			let iconRel = null;
			if (
				body.kind === 'freehand-classify' &&
				typeof body.iconPngBase64 === 'string' &&
				body.iconPngBase64.length > 32
			) {
				try {
					// One copy, inside this analysis's own folder.
					const safeId = String(entryId).replace(/[^\w.-]+/g, '_');
					const abs = path.join(store.freehandIcons, `${safeId}.png`);
					const b64 = body.iconPngBase64.replace(/^data:image\/png;base64,/, '');
					await fsp.writeFile(abs, Buffer.from(b64, 'base64'));
					iconRel = toRepoRel(abs);
				} catch {
					iconRel = null;
				}
			}
			const entry = {
				id: entryId,
				code: String(body.code),
				kind: body.kind,
				from: body.from ?? null,
				to: body.to ?? null,
				points: Array.isArray(body.points) ? body.points : null,
				name: body.name != null ? String(body.name) : null,
				tier:
					body.tier === null || body.tier === undefined || body.tier === ''
						? null
						: Number(body.tier),
				difficultyNote: body.difficultyNote != null ? String(body.difficultyNote) : null,
				score:
					body.score === null || body.score === undefined || body.score === ''
						? body.kind === 'freehand-classify'
							? 1
							: null
						: Number(body.score),
				assignedPathways,
				assignedPathway: assignedPathways[0] || null,
				iconRel,
				note: body.note || '',
				createdAt,
			};
			list.push(entry);
			const next = { feedback: list, updatedAt: createdAt };
			await saveJson(store.trainingFeedback, next);
			await saveActiveSessionMeta();
			sendJson(res, 200, { ok: true, trainingFeedback: next });
			return;
		}

		if (method === 'POST' && pathname === '/api/annotations/clear') {
			const { store } = await activeStore();
			await saveJson(store.annotations, {
				annotations: [],
				updatedAt: new Date().toISOString(),
			});
			await saveActiveSessionMeta();
			sendJson(res, 200, { ok: true });
			return;
		}

		/**
		 * Hard-delete a Database View row from active datasets:
		 * - match (+ cx/cy): scrub annotations + related feedback, remove findings instance,
		 *   persist a `deleted` marker so rematch / reload stays suppressed
		 * - match + deleteCode: purge pending/code-level placeholder via `deleted-code`
		 * - freehand: remove the freehand-classify feedback entry (+ icon file)
		 */
		if (method === 'POST' && pathname === '/api/database-row/delete') {
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			const kind = body.kind === 'freehand' ? 'freehand' : 'match';
			const code = body.code != null ? String(body.code) : '';
			const deleteCode = Boolean(body.deleteCode);
			const now = new Date().toISOString();

			const { store } = await activeStore();
			const existingAnn = (await loadJson(store.annotations)) || { annotations: [] };
			const existingFb = (await loadJson(store.trainingFeedback)) || { feedback: [] };
			let annotationsList = Array.isArray(existingAnn.annotations)
				? [...existingAnn.annotations]
				: [];
			let feedbackList = Array.isArray(existingFb.feedback) ? [...existingFb.feedback] : [];
			let findingsRemoved = false;
			let freehandRemoved = false;

			if (kind === 'freehand') {
				const feedbackId = body.feedbackId != null ? String(body.feedbackId) : '';
				if (!feedbackId) {
					sendJson(res, 400, { error: 'feedbackId required for freehand delete' });
					return;
				}
				const before = feedbackList.length;
				const removed = feedbackList.filter((f) => f.id === feedbackId);
				feedbackList = feedbackList.filter((f) => f.id !== feedbackId);
				freehandRemoved = feedbackList.length < before;
				for (const entry of removed) {
					if (!entry?.iconRel) continue;
					// Icons live in this store's own freehand-icons dir.
					await fsp
						.unlink(path.join(store.freehandIcons, path.basename(String(entry.iconRel))))
						.catch(() => {});
				}
			} else if (deleteCode) {
				if (!code) {
					sendJson(res, 400, { error: 'code required for deleteCode' });
					return;
				}
				annotationsList = annotationsList.filter((a) => a?.code !== code);
				feedbackList = feedbackList.filter((f) => {
					if (f?.kind === 'deleted-code' && f.code === code) return false;
					if (f?.kind === 'freehand-classify') return true;
					if (f?.kind === 'deleted') return true;
					if (f?.code !== code) return true;
					// Drop review feedback tied to this code (confirmed/FP mirrors, etc.).
					return false;
				});
				const already = feedbackList.some(
					(f) => f.kind === 'deleted-code' && f.code === code,
				);
				if (!already) {
					feedbackList.push({
						id: `deleted-code-${code}-${Date.now()}`,
						code,
						kind: 'deleted-code',
						from: null,
						to: null,
						points: null,
						note: body.note || 'Deleted pending row from Database View',
						createdAt: now,
					});
				}
				const findings = (await loadJson(store.findings)) || { items: {} };
				const item = findings.items?.[code];
				if (item && Array.isArray(item.instances) && item.instances.length > 0) {
					item.instances = [];
					item.instanceCount = 0;
					item.bestScore = null;
					item.status = item.status === 'found' ? 'missed' : item.status;
					findings.meta = {
						...(findings.meta || {}),
						updatedAt: now,
						lastDeletedAt: now,
					};
					await saveJson(store.findings, findings);
					findingsRemoved = true;
				}
			} else {
				if (!code || body.cx == null || body.cy == null) {
					sendJson(res, 400, { error: 'code, cx, and cy required for match delete' });
					return;
				}
				const cx = Number(body.cx);
				const cy = Number(body.cy);
				const scrubbed = scrubHitReviewData(annotationsList, feedbackList, code, cx, cy);
				annotationsList = scrubbed.annotations;
				feedbackList = scrubbed.feedback;

				const alreadyDeleted = feedbackList.some(
					(f) =>
						f.kind === 'deleted' &&
						f.code === code &&
						f.from &&
						centersNear(f.from.cx, f.from.cy, cx, cy),
				);
				if (!alreadyDeleted) {
					feedbackList.push({
						id: `deleted-${code}:${cx}:${cy}-${Date.now()}`,
						code,
						kind: 'deleted',
						from: { cx, cy },
						to: null,
						points: null,
						note: body.note || 'Deleted from Database View',
						createdAt: now,
					});
				}

				const findings = (await loadJson(store.findings)) || { items: {} };
				const { findings: nextFindings, removed } = removeFindingInstance(
					findings,
					code,
					cx,
					cy,
				);
				findingsRemoved = removed;
				if (removed) {
					nextFindings.meta = {
						...(nextFindings.meta || {}),
						updatedAt: now,
						lastDeletedAt: now,
					};
					await saveJson(store.findings, nextFindings);
				}
			}

			const annotations = { annotations: annotationsList, updatedAt: now };
			const trainingFeedback = { feedback: feedbackList, updatedAt: now };
			await saveJson(store.annotations, annotations);
			await saveJson(store.trainingFeedback, trainingFeedback);
			await saveActiveSessionMeta();
			sendJson(res, 200, {
				ok: true,
				kind,
				code: code || null,
				findingsRemoved,
				freehandRemoved,
				annotations,
				trainingFeedback,
			});
			return;
		}

		// --- Saved analyses ---

		if (method === 'GET' && pathname === '/api/analyses') {
			const list = await Promise.all((await listAnalyses()).map((m) => summarizeAnalysis(m)));
			sendJson(res, 200, { analyses: list });
			return;
		}

		if (method === 'POST' && pathname === '/api/analyses') {
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			const meta = await createAnalysis(body.name || 'Untitled analysis');
			sendJson(res, 201, { ok: true, analysis: meta });
			return;
		}

		if (method === 'POST' && pathname === '/api/analyses/save-current') {
			const session = await readSession();
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			let id = session.analysisId;
			if (!id) {
				const created = await createAnalysis(body.name || 'Lung Cutaway Neutral (current)');
				id = created.id;
				// Defaults-mode work is being adopted: import the site tree once, by
				// explicit request. Nothing is moved out of any other analysis.
				await importStoreIntoAnalysis(id, SITE_STORE);
			}
			const meta = await saveAnalysisSession(id, {
				cutawayPath: session.cutawayPath,
				legendPath: session.legendPath,
				usingDefaults: session.usingDefaults,
				phase: session.phase === 'classify' ? 'classify' : 'refine',
				screen: session.screen,
				refineScreen: session.refineScreen,
				tierToTest: session.tierToTest,
				name: body.name,
			});
			await writeSession({
				...session,
				analysisId: id,
				phase: meta.phase,
				screen: meta.phase,
				tierToTest: meta.tierToTest ?? session.tierToTest,
				refineScreen: meta.refineScreen ?? session.refineScreen,
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 200, { ok: true, analysis: await summarizeAnalysis(meta) });
			return;
		}

		if (method === 'POST' && pathname === '/api/analyses/seed-current') {
			const meta = await seedCurrentAnalysis();
			const opened = await openAndReconcile(meta.id);
			await writeSession({
				...opened,
				screen: opened.screen || 'refine',
				phase: opened.phase || 'refine',
			});
			sendJson(res, 200, { ok: true, analysis: await summarizeAnalysis(meta), session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/open')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/open'.length));
			// Opening is a pointer move: the previous analysis keeps its own files and
			// any job still running against them, so there is nothing to flush here.
			// An analysis whose images were never uploaded resumes the wizard at upload
			// rather than failing (and without inheriting another analysis's outputs).
			if (await analysisNeedsImages(id)) {
				const fresh = analysisPaths(id);
				await writeSession({
					cutawayPath: fresh.cutaway,
					legendPath: fresh.legend,
					usingDefaults: false,
					analysisId: id,
					phase: 'classify',
					screen: 'classify',
					refineScreen: 'image',
					tierToTest: 1,
					updatedAt: new Date().toISOString(),
				});
				const pending = await getAnalysisMeta(id);
				sendJson(res, 200, {
					ok: true,
					analysis: pending ? await summarizeAnalysis(pending) : null,
					session: await readSession(),
				});
				return;
			}
			const opened = await openAndReconcile(id);
			await writeSession({
				...opened,
				screen: opened.screen || (opened.phase === 'classify' ? 'classify' : 'refine'),
				phase: opened.phase || 'refine',
			});
			const meta = await getAnalysisMeta(id);
			sendJson(res, 200, {
				ok: true,
				analysis: meta ? await summarizeAnalysis(meta) : null,
				session: await readSession(),
			});
			return;
		}

		if (method === 'PUT' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/name')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/name'.length));
			if (!id || id.includes('/') || id.includes('..')) {
				sendJson(res, 400, { error: 'invalid analysis id' });
				return;
			}
			const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
			const name = typeof body.name === 'string' ? body.name.trim() : '';
			if (!name) {
				sendJson(res, 400, { error: 'name is required' });
				return;
			}
			if (!(await getAnalysisMeta(id))) {
				sendJson(res, 404, { error: `No analysis ${id}` });
				return;
			}
			// Metadata-only write: no live-workspace flush or snapshot is needed, so
			// renaming never touches the lease or the pipeline outputs.
			const meta = await updateAnalysisMeta(id, { name });
			const list = await Promise.all((await listAnalyses()).map((m) => summarizeAnalysis(m)));
			sendJson(res, 200, { ok: true, id, name: meta.name, analyses: list });
			return;
		}

		if (method === 'DELETE' && pathname.startsWith('/api/analyses/')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length));
			if (!id || id.includes('/')) {
				sendJson(res, 400, { error: 'invalid analysis id' });
				return;
			}
			const session = await readSession();
			await deleteAnalysis(id);
			if (session.analysisId === id) {
				// Images lived inside the deleted folder — fall back to the defaults.
				await writeSession({
					...session,
					cutawayPath: DEFAULT_CUTAWAY,
					legendPath: DEFAULT_LEGEND,
					usingDefaults: true,
					analysisId: null,
					screen: 'home',
					phase: 'classify',
					refineScreen: 'image',
					tierToTest: 1,
					updatedAt: new Date().toISOString(),
				});
			}
			const list = await Promise.all((await listAnalyses()).map((m) => summarizeAnalysis(m)));
			sendJson(res, 200, {
				ok: true,
				id,
				analyses: list,
				session: await readSession(),
			});
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/save')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/save'.length));
			const session = await readSession();
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			const meta = await saveAnalysisSession(id, {
				cutawayPath: session.cutawayPath,
				legendPath: session.legendPath,
				usingDefaults: session.usingDefaults,
				phase: body.phase || session.phase || 'refine',
				screen: session.screen,
				refineScreen: session.refineScreen,
				tierToTest: session.tierToTest,
				name: body.name,
			});
			await writeSession({
				...session,
				analysisId: id,
				phase: meta.phase,
				screen: meta.phase,
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 200, { ok: true, analysis: await summarizeAnalysis(meta) });
			return;
		}

		if (method === 'POST' && pathname === '/api/session/home') {
			const session = await readSession();
			if (session.analysisId) {
				await saveAnalysisSession(session.analysisId, {
					cutawayPath: session.cutawayPath,
					legendPath: session.legendPath,
					usingDefaults: session.usingDefaults,
					phase: session.phase === 'classify' ? 'classify' : 'refine',
					screen: 'home',
					refineScreen: session.refineScreen,
					tierToTest: session.tierToTest,
				});
			}
			await writeSession({
				...session,
				analysisId: session.analysisId,
				screen: 'home',
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 200, { ok: true, session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname === '/api/session/phase') {
			const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
			const session = await readSession();
			const phase = body.phase === 'classify' ? 'classify' : 'refine';
			if (session.analysisId) {
				await updateAnalysisMeta(session.analysisId, { phase, screen: phase });
			}
			await writeSession({
				...session,
				phase,
				screen: phase,
				updatedAt: new Date().toISOString(),
			});
			if (session.analysisId) {
				await saveActiveSessionMeta();
			}
			sendJson(res, 200, { ok: true, session: await readSession() });
			return;
		}

		if (method === 'PUT' && pathname === '/api/session/ui-state') {
			const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
			const session = await readSession();
			const analysisMeta = session.analysisId ? await getAnalysisMeta(session.analysisId) : null;
			const refineScreen =
				body.refineScreen === 'database' || body.refineScreen === 'legend'
					? body.refineScreen
					: body.refineScreen === 'image'
						? 'image'
						: session.refineScreen;
			const requestedTier =
				typeof body.tierToTest === 'number' && body.tierToTest >= 1
					? Math.min(3, Math.max(1, body.tierToTest))
					: session.tierToTest;
			const { tierToTest, maxUnlockedTier } = resolveActiveTierToTest(
				requestedTier,
				analysisMeta?.maxUnlockedTier ?? session.tierToTest ?? 1,
				{ usingDefaults: analysisMeta?.usingDefaults },
			);
			const next = await writeSession({
				...session,
				refineScreen,
				tierToTest,
				updatedAt: new Date().toISOString(),
			});
			if (session.analysisId) {
				await updateAnalysisMeta(session.analysisId, {
					refineScreen,
					tierToTest,
					maxUnlockedTier,
					screen: session.screen === 'home' ? 'home' : session.phase,
				});
			}
			sendJson(res, 200, {
				ok: true,
				session: next,
				refineScreen,
				tierToTest,
			});
			return;
		}

		if (method === 'PUT' && pathname === '/api/session/tier-gate') {
			const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
			const session = await readSession();
			if (!session.analysisId) {
				sendJson(res, 400, { error: 'No active analysis' });
				return;
			}
			const maxUnlockedTier = Math.min(3, Math.max(1, Number(body.maxUnlockedTier) || 1));
			const refineScreen =
				body.refineScreen === 'database' || body.refineScreen === 'legend'
					? body.refineScreen
					: body.refineScreen === 'image'
						? 'image'
						: session.refineScreen;
			const requestedTier =
				typeof body.tierToTest === 'number' && body.tierToTest >= 1
					? Math.min(3, Math.max(1, body.tierToTest))
					: maxUnlockedTier;
			const { tierToTest } = resolveActiveTierToTest(requestedTier, maxUnlockedTier);
			const meta = await updateAnalysisMeta(session.analysisId, {
				maxUnlockedTier,
				tierToTest,
				refineScreen,
			});
			await writeSession({
				...session,
				tierToTest,
				refineScreen,
				updatedAt: new Date().toISOString(),
			});
			await saveActiveSessionMeta();
			sendJson(res, 200, {
				ok: true,
				maxUnlockedTier: meta.maxUnlockedTier ?? maxUnlockedTier,
				tierToTest,
				refineScreen,
			});
			return;
		}

		if (method === 'GET' && pathname === '/api/style-guide-profiles') {
			sendJson(res, 200, {
				ok: true,
				defaultProfileId: DEFAULT_STYLE_GUIDE_PROFILE_ID,
				profiles: await listStyleGuideProfileSummaries(),
			});
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/style-guide-profiles/')) {
			const id = decodeURIComponent(pathname.slice('/api/style-guide-profiles/'.length));
			const profile = await loadStyleGuideProfile(id);
			if (!profile) {
				sendJson(res, 404, { error: `Unknown style guide profile: ${id}` });
				return;
			}
			sendJson(res, 200, { ok: true, profile });
			return;
		}

		if (method === 'PUT' && pathname.startsWith('/api/style-guide-profiles/')) {
			const id = decodeURIComponent(pathname.slice('/api/style-guide-profiles/'.length));
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
			try {
				const brief = await updateStyleGuideProfile(id, body.profile || body, {
					markdown: body.markdown,
				});
				const session = await readSession();
				if (session.analysisId) {
					const meta = await getAnalysisMeta(session.analysisId);
					if (meta?.styleGuideProfileId === id || body.bindToSession) {
						await updateAnalysisMeta(session.analysisId, { styleGuideProfileId: id });
					}
				}
				await saveActiveSessionMeta();
				sendJson(res, 200, {
					ok: true,
					styleGuideProfileId: id,
					styleGuideProfile: brief,
					profiles: await listStyleGuideProfileSummaries(),
					state: await buildState(),
				});
			} catch (err) {
				const status = err?.statusCode || 500;
				sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
			}
			return;
		}

		if (method === 'POST' && pathname === '/api/style-guide-profiles') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
			try {
				const created = await createStyleGuideProfile({
					id: body.id,
					profile: body.profile || body,
					markdown: body.markdown,
				});
				const session = await readSession();
				if (session.analysisId && body.bindToSession !== false) {
					await updateAnalysisMeta(session.analysisId, {
						styleGuideProfileId: created.id,
					});
				}
				await saveActiveSessionMeta();
				sendJson(res, 201, {
					ok: true,
					styleGuideProfileId: created.id,
					styleGuideProfile: created.brief,
					profiles: await listStyleGuideProfileSummaries(),
					state: await buildState(),
				});
			} catch (err) {
				const status = err?.statusCode || 500;
				sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
			}
			return;
		}

		if (method === 'PUT' && pathname === '/api/session/style-guide-profile') {
			const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
			const session = await readSession();
			if (!session.analysisId) {
				sendJson(res, 400, { error: 'No active analysis to bind a style guide profile' });
				return;
			}
			const profileId = await resolveStyleGuideProfileId(body.profileId || body.id);
			await updateAnalysisMeta(session.analysisId, { styleGuideProfileId: profileId });
			sendJson(res, 200, {
				ok: true,
				styleGuideProfileId: profileId,
				styleGuideProfile: await getStyleGuideProfileBrief(profileId),
				state: await buildState(),
			});
			return;
		}

		if (method === 'POST' && pathname === '/api/analyses/new') {
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			// Record where the outgoing analysis left off, then point the session at a
			// brand-new empty folder. Nothing is wiped: the outgoing analysis keeps its
			// own files, so a job still running against it is unaffected.
			await saveActiveSessionMeta();
			const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
			const meta = await createAnalysis(requestedName || 'New analysis');
			const fresh = analysisPaths(meta.id);
			await writeSession({
				// Point at this analysis's own (not yet uploaded) images.
				cutawayPath: fresh.cutaway,
				legendPath: fresh.legend,
				usingDefaults: false,
				analysisId: meta.id,
				phase: 'classify',
				screen: 'classify',
				refineScreen: 'image',
				tierToTest: 1,
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 201, { ok: true, analysis: meta, session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/images')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/images'.length));
			if (!id || id.includes('/') || id.includes('..')) {
				sendJson(res, 400, { error: 'invalid analysis id' });
				return;
			}
			const body = await readBody(req);
			const { files, fields } = parseMultipart(body, req.headers['content-type'] || '');
			// Images land inside this analysis's own folder, so uploading while another
			// analysis is mid-job neither waits on it nor disturbs its files.
			const session0 = await readSession();
			if (session0.analysisId && session0.analysisId !== id) {
				await saveActiveSessionMeta();
			}
			const written = await writeAnalysisImages(id, {
				cutaway: files.cutaway?.data,
				legend: files.legend?.data,
			});
			const session = await readSession();
			await writeSession({
				...session,
				analysisId: id,
				cutawayPath: written.cutawayPath || session.cutawayPath,
				legendPath: written.legendPath || session.legendPath,
				usingDefaults: false,
				phase: 'classify',
				screen: 'classify',
				updatedAt: new Date().toISOString(),
			});
			if (fields.name) {
				await updateAnalysisMeta(id, { name: fields.name });
			}
			sendJson(res, 200, { ok: true, session: await readSession() });
			return;
		}

		sendJson(res, 404, { error: `No route ${method} ${pathname}` });
	} catch (err) {
		console.error(err);
		sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
	}
}

/**
 * Annotate a match job log when findings refresh starts.
 * @param {import('./jobs.mjs').Job} job
 */
function pushFindingsRefresh(job) {
	job.log.push('· Refreshing findings DB…');
}

/**
 * Normalize RL export scope from request body (`'all'` or a tier number).
 * @param {unknown} value
 * @returns {number | 'all'}
 */
function normalizeRlTierScope(value) {
	if (value === 'all') return 'all';
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * Write RL feedback prompt markdown + JSON (with delta cursor) for Cursor export.
 *
 * Writes only inside the store for `analysisId` (the shared workspace copy is used
 * only in defaults mode), so an export never touches another analysis's RL state.
 *
 * @param {{tierToTest: number | 'all', promptMarkdown: string, summary: unknown, cursor: unknown, analysisId: string | null}} opts
 * @returns {Promise<{md: string, json: string}>} Absolute paths written.
 */
async function writeRlFeedbackArtifacts(opts) {
	const { tierToTest, promptMarkdown, summary, cursor, analysisId } = opts;
	const payload = {
		tierToTest,
		generatedAt: new Date().toISOString(),
		summary,
		cursor: cursor || null,
		note: 'Delta RL feedback for Cursor; rematch is done outside this lab.',
	};
	const scopeLabel = tierToTest === 'all' ? 'all tiers' : `Tier ${tierToTest}`;
	const mdBody =
		promptMarkdown?.trim() ||
		`# RL feedback for ${scopeLabel}\n\n(empty — no new owner review)\n`;

	// An analysis's own folder is the only home for its prompt. The workspace copy
	// exists solely for defaults mode (no analysis bound), so exporting a prompt for
	// one analysis can never overwrite another's RL state.
	const store = storeFor(analysisId);
	await fsp.mkdir(path.dirname(store.rlFeedbackMd), { recursive: true });
	await fsp.mkdir(path.dirname(store.rlFeedback), { recursive: true });
	await fsp.writeFile(store.rlFeedbackMd, mdBody, 'utf8');
	await fsp.writeFile(store.rlFeedback, JSON.stringify(payload, null, 2), 'utf8');
	if (analysisId) {
		await appendRlFeedbackHistory(analysisId, {
			tierToTest,
			promptMarkdown: mdBody,
			summary,
			cursor: cursor || null,
			generatedAt: payload.generatedAt,
		});
	}

	return { md: store.rlFeedbackMd, json: store.rlFeedback };
}

await ensureWorkspace();
const server = http.createServer((req, res) => {
	void handle(req, res);
});
server.listen(PORT, HOST, () => {
	console.log(`✓ Lung Legend Lab API  http://${HOST}:${PORT}`);
	console.log(`  defaults: ${toRepoRel(DEFAULT_CUTAWAY)}`);
	console.log(`           ${toRepoRel(DEFAULT_LEGEND)}`);
});
