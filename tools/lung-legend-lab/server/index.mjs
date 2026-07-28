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
	EXTRACT_JSON,
	CLASSIFICATION_JSON,
	FINDINGS_DB,
	MATCH_REPORT,
	ANNOTATIONS_JSON,
	TRAINING_FEEDBACK_JSON,
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
	snapshotAnalysis,
	restoreAnalysis,
	writeAnalysisImages,
	updateAnalysisMeta,
	getAnalysisMeta,
	seedCurrentAnalysis,
} from './analyses.mjs';

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

/**
 * Ensure workspace, analyses store, and a default session exist.
 * @returns {Promise<void>}
 */
async function ensureWorkspace() {
	await fsp.mkdir(WORKSPACE, { recursive: true });
	await ensureAnalysesStore();
	if (!fs.existsSync(SESSION_PATH)) {
		const seeded = await seedCurrentAnalysis();
		const restored = await restoreAnalysis(seeded.id);
		await writeSession({
			...restored,
			screen: 'refine',
			phase: 'refine',
		});
		return;
	}
	const raw = JSON.parse(await fsp.readFile(SESSION_PATH, 'utf8'));
	if (!raw.analysisId) {
		const seeded = await seedCurrentAnalysis();
		const restored = await restoreAnalysis(seeded.id);
		await writeSession({
			...restored,
			screen: raw.screen || 'refine',
			phase: 'refine',
		});
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
		updatedAt: raw.updatedAt || new Date().toISOString(),
	};
}

/**
 * Snapshot the active analysis after pipeline steps (best-effort).
 * @returns {Promise<object | null>}
 */
async function snapshotActiveIfAny() {
	const session = await readSession();
	if (!session.analysisId) return null;
	return snapshotAnalysis(session.analysisId, {
		cutawayPath: session.cutawayPath,
		legendPath: session.legendPath,
		usingDefaults: session.usingDefaults,
		phase: session.phase === 'classify' ? 'classify' : 'refine',
	});
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
		'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
	const session = await readSession();
	const [extract, classification, findings, matchReport, annotations, trainingFeedback] =
		await Promise.all([
			loadJson(EXTRACT_JSON),
			loadJson(CLASSIFICATION_JSON),
			loadJson(FINDINGS_DB),
			loadJson(MATCH_REPORT),
			loadJson(ANNOTATIONS_JSON),
			loadJson(TRAINING_FEEDBACK_JSON),
		]);

	const outlineSlugs = [];
	try {
		const names = await fsp.readdir(LAYERS_DIR);
		for (const name of names) {
			if (name.endsWith('-outline.png')) {
				outlineSlugs.push(name.replace(/-outline\.png$/, ''));
			}
		}
	} catch {
		/* empty */
	}

	const analysisMeta = session.analysisId ? await getAnalysisMeta(session.analysisId) : null;
	const analyses = await Promise.all((await listAnalyses()).map((m) => summarizeAnalysis(m)));

	return {
		ok: true,
		maintainerOnly: true,
		session: {
			...session,
			cutawayRel: toRepoRel(session.cutawayPath),
			legendRel: toRepoRel(session.legendPath),
			cutawayExists: fs.existsSync(session.cutawayPath),
			legendExists: fs.existsSync(session.legendPath),
			analysisName: analysisMeta?.name || null,
		},
		analyses,
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
		paths: {
			extract: toRepoRel(EXTRACT_JSON),
			classification: toRepoRel(CLASSIFICATION_JSON),
			findings: toRepoRel(FINDINGS_DB),
			matchReport: toRepoRel(MATCH_REPORT),
			annotations: toRepoRel(ANNOTATIONS_JSON),
			trainingFeedback: toRepoRel(TRAINING_FEEDBACK_JSON),
		},
	};
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
				slug: cls.slug ?? find.slug ?? null,
				note: cls.note ?? find.note ?? null,
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
			'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
			const [extract, classification, findings] = await Promise.all([
				loadJson(EXTRACT_JSON),
				loadJson(CLASSIFICATION_JSON),
				loadJson(FINDINGS_DB),
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
			sendJson(res, 200, (await loadJson(FINDINGS_DB)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/match-report') {
			sendJson(res, 200, (await loadJson(MATCH_REPORT)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/extract') {
			sendJson(res, 200, (await loadJson(EXTRACT_JSON)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/classification') {
			sendJson(res, 200, (await loadJson(CLASSIFICATION_JSON)) || { error: 'missing' });
			return;
		}

		if (method === 'GET' && pathname === '/api/annotations') {
			sendJson(res, 200, (await loadJson(ANNOTATIONS_JSON)) || { annotations: [] });
			return;
		}

		if (method === 'GET' && pathname === '/api/training-feedback') {
			sendJson(res, 200, (await loadJson(TRAINING_FEEDBACK_JSON)) || { feedback: [] });
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
			await sendFile(res, path.join(LAYERS_DIR, `${slug}-outline.png`), 'image/png');
			return;
		}

		if (method === 'GET' && pathname.startsWith('/api/assets/glyph/')) {
			const code = decodeURIComponent(pathname.slice('/api/assets/glyph/'.length));
			if (!/^[AB][1-9]$/.test(code)) {
				sendJson(res, 400, { error: 'invalid code' });
				return;
			}
			await sendFile(res, path.join(DEBUG_DIR, 'legend-items', `${code}-glyph.png`), 'image/png');
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
			const session = await writeSession({
				cutawayPath: DEFAULT_CUTAWAY,
				legendPath: DEFAULT_LEGEND,
				usingDefaults: true,
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

			if (files.cutaway) {
				cutawayPath = path.join(WORKSPACE, 'active-cutaway.png');
				await fsp.writeFile(cutawayPath, files.cutaway.data);
				usingDefaults = false;
			}
			if (files.legend) {
				legendPath = path.join(WORKSPACE, 'active-legend.png');
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
				await snapshotAnalysis(next.analysisId, {
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
			const job = createJob('extract', { legend: toRepoRel(session.legendPath) });
			void (async () => {
				await runProcessJob(
					job,
					process.execPath,
					[RUN_LUNG_PYTHON, OBSERVABILITY_PY, '--extract-only', '--legend', session.legendPath],
					ROOT,
				);
				if (job.status === 'succeeded') {
					try {
						await snapshotActiveIfAny();
						job.log.push('· Analysis snapshot saved');
					} catch (err) {
						job.log.push(`· Snapshot warn: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'POST' && pathname === '/api/match') {
			const session = await readSession();
			const job = createJob('match', {
				cutaway: toRepoRel(session.cutawayPath),
				legend: toRepoRel(session.legendPath),
			});
			void (async () => {
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
					],
					ROOT,
				);
				if (job.status === 'succeeded') {
					pushFindingsRefresh(job);
					const findingsJob = createJob('findings', { parent: job.id });
					await runProcessJob(
						findingsJob,
						process.execPath,
						[RUN_LUNG_PYTHON, FINDINGS_DB_PY],
						ROOT,
					);
					job.meta.findingsJobId = findingsJob.id;
					job.meta.findingsStatus = findingsJob.status;
					for (const line of findingsJob.log) job.log.push(line);
					try {
						await snapshotActiveIfAny();
						job.log.push('· Analysis snapshot saved');
					} catch (err) {
						job.log.push(`· Snapshot warn: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'POST' && pathname === '/api/findings/refresh') {
			const job = createJob('findings', {});
			void (async () => {
				await runProcessJob(job, process.execPath, [RUN_LUNG_PYTHON, FINDINGS_DB_PY], ROOT);
				if (job.status === 'succeeded') {
					try {
						await snapshotActiveIfAny();
						job.log.push('· Analysis snapshot saved');
					} catch (err) {
						job.log.push(`· Snapshot warn: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
			})();
			sendJson(res, 202, serializeJob(job));
			return;
		}

		if (method === 'PUT' && pathname === '/api/classification') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
			const existing = (await loadJson(CLASSIFICATION_JSON)) || {
				source: toRepoRel(DEFAULT_LEGEND),
				guidelines: '',
				subTierHelp: {},
				iconInterpretationHelp: {},
				classifications: {},
			};
			if (body.classifications && typeof body.classifications === 'object') {
				existing.classifications = {
					...existing.classifications,
					...body.classifications,
				};
			}
			if (typeof body.guidelines === 'string') existing.guidelines = body.guidelines;
			existing.updatedAt = new Date().toISOString();
			existing.updatedBy = 'lung-legend-lab';
			await saveJson(CLASSIFICATION_JSON, existing);

			// Keep findings DB classification fields in sync without a full match rerun.
			runLungPythonSync([FINDINGS_DB_PY]);
			await snapshotActiveIfAny();
			sendJson(res, 200, { ok: true, classification: existing });
			return;
		}

		if (method === 'PUT' && pathname.startsWith('/api/classification/')) {
			const code = decodeURIComponent(pathname.slice('/api/classification/'.length));
			if (!/^[AB][1-9]$/.test(code)) {
				sendJson(res, 400, { error: 'invalid code' });
				return;
			}
			const patch = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'));
			const existing = (await loadJson(CLASSIFICATION_JSON)) || {
				source: toRepoRel(DEFAULT_LEGEND),
				classifications: {},
			};
			const prev = existing.classifications?.[code] || {};
			const next = {
				...prev,
				...patch,
				tier: patch.tier !== undefined ? Number(patch.tier) : prev.tier,
				searchable:
					patch.searchable !== undefined
						? Boolean(patch.searchable)
						: patch.tier !== undefined
							? Number(patch.tier) > 0
							: prev.searchable,
			};
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
			await saveJson(CLASSIFICATION_JSON, existing);
			runLungPythonSync([FINDINGS_DB_PY]);
			await snapshotActiveIfAny();
			sendJson(res, 200, { ok: true, code, classification: next });
			return;
		}

		if (method === 'PUT' && pathname === '/api/annotations') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
			const existing = (await loadJson(ANNOTATIONS_JSON)) || { annotations: [] };
			const list = Array.isArray(existing.annotations) ? [...existing.annotations] : [];
			const entry = {
				id: body.id || `${body.code}:${body.cx}:${body.cy}`,
				code: body.code,
				cx: body.cx,
				cy: body.cy,
				score: body.score ?? null,
				label: body.label, // confirmed | false-positive | reassigned
				reassignedCode: body.reassignedCode || null,
				note: body.note || '',
				updatedAt: new Date().toISOString(),
			};
			const idx = list.findIndex((a) => a.id === entry.id);
			if (idx >= 0) list[idx] = { ...list[idx], ...entry };
			else list.push(entry);
			const next = { annotations: list, updatedAt: entry.updatedAt };
			await saveJson(ANNOTATIONS_JSON, next);

			// Mirror review labels into training feedback for tier-1 conclusion history.
			const kindMap = {
				confirmed: 'confirmed',
				'false-positive': 'false-positive',
				reassigned: 'reassigned',
			};
			const feedbackKind = kindMap[entry.label];
			if (feedbackKind) {
				const fb = (await loadJson(TRAINING_FEEDBACK_JSON)) || { feedback: [] };
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
				await saveJson(TRAINING_FEEDBACK_JSON, {
					feedback: feedbackList,
					updatedAt: entry.updatedAt,
				});
			}

			await snapshotActiveIfAny();
			sendJson(res, 200, { ok: true, annotations: next });
			return;
		}

		if (method === 'POST' && pathname === '/api/training-feedback') {
			const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'));
			const existing = (await loadJson(TRAINING_FEEDBACK_JSON)) || { feedback: [] };
			const list = Array.isArray(existing.feedback) ? [...existing.feedback] : [];
			const allowed = new Set([
				'relocate',
				'resize',
				'trace',
				'false-positive',
				'confirmed',
				'reassigned',
			]);
			if (!body.code || !allowed.has(body.kind)) {
				sendJson(res, 400, { error: 'code and valid kind required' });
				return;
			}
			const createdAt = new Date().toISOString();
			const entry = {
				id: body.id || `fb-${body.kind}-${body.code}-${Date.now()}`,
				code: String(body.code),
				kind: body.kind,
				from: body.from ?? null,
				to: body.to ?? null,
				points: Array.isArray(body.points) ? body.points : null,
				note: body.note || '',
				createdAt,
			};
			list.push(entry);
			const next = { feedback: list, updatedAt: createdAt };
			await saveJson(TRAINING_FEEDBACK_JSON, next);
			await snapshotActiveIfAny();
			sendJson(res, 200, { ok: true, trainingFeedback: next });
			return;
		}

		if (method === 'POST' && pathname === '/api/annotations/clear') {
			await saveJson(ANNOTATIONS_JSON, {
				annotations: [],
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 200, { ok: true });
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
			}
			const meta = await snapshotAnalysis(id, {
				cutawayPath: session.cutawayPath,
				legendPath: session.legendPath,
				usingDefaults: session.usingDefaults,
				phase: session.phase === 'classify' ? 'classify' : 'refine',
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

		if (method === 'POST' && pathname === '/api/analyses/seed-current') {
			const meta = await seedCurrentAnalysis();
			const restored = await restoreAnalysis(meta.id);
			await writeSession({
				...restored,
				screen: 'refine',
				phase: 'refine',
			});
			sendJson(res, 200, { ok: true, analysis: await summarizeAnalysis(meta), session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/open')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/open'.length));
			const restored = await restoreAnalysis(id);
			const meta = await getAnalysisMeta(id);
			await writeSession({
				...restored,
				screen: meta?.phase === 'classify' ? 'classify' : 'refine',
				phase: meta?.phase || 'refine',
			});
			sendJson(res, 200, {
				ok: true,
				analysis: meta ? await summarizeAnalysis(meta) : null,
				session: await readSession(),
			});
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/save')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/save'.length));
			const session = await readSession();
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			const meta = await snapshotAnalysis(id, {
				cutawayPath: session.cutawayPath,
				legendPath: session.legendPath,
				usingDefaults: session.usingDefaults,
				phase: body.phase || session.phase || 'refine',
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
				await snapshotAnalysis(session.analysisId, {
					cutawayPath: session.cutawayPath,
					legendPath: session.legendPath,
					usingDefaults: session.usingDefaults,
					phase: session.phase === 'classify' ? 'classify' : 'refine',
				});
			}
			await writeSession({
				...session,
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
				await updateAnalysisMeta(session.analysisId, { phase });
			}
			await writeSession({
				...session,
				phase,
				screen: phase,
				updatedAt: new Date().toISOString(),
			});
			if (session.analysisId) {
				await snapshotActiveIfAny();
			}
			sendJson(res, 200, { ok: true, session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname === '/api/analyses/new') {
			const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
			const meta = await createAnalysis(body.name || 'New analysis');
			const workCutaway = path.join(WORKSPACE, 'active-cutaway.png');
			const workLegend = path.join(WORKSPACE, 'active-legend.png');
			// Clear live classification/findings so the wizard starts clean.
			await saveJson(EXTRACT_JSON, { items: [], source: null });
			await saveJson(CLASSIFICATION_JSON, {
				source: null,
				guidelines: '',
				classifications: {},
				updatedAt: new Date().toISOString(),
				updatedBy: 'lung-legend-lab',
			});
			await saveJson(FINDINGS_DB, { items: {}, runs: [], meta: { phase: 'new analysis' } });
			await saveJson(MATCH_REPORT, { layers: {}, method: 'opencv-template-match' });
			await saveJson(ANNOTATIONS_JSON, { annotations: [] });
			await saveJson(TRAINING_FEEDBACK_JSON, { feedback: [] });
			await writeSession({
				cutawayPath: workCutaway,
				legendPath: workLegend,
				usingDefaults: false,
				analysisId: meta.id,
				phase: 'classify',
				screen: 'classify',
				updatedAt: new Date().toISOString(),
			});
			sendJson(res, 201, { ok: true, analysis: meta, session: await readSession() });
			return;
		}

		if (method === 'POST' && pathname.startsWith('/api/analyses/') && pathname.endsWith('/images')) {
			const id = decodeURIComponent(pathname.slice('/api/analyses/'.length, -'/images'.length));
			const body = await readBody(req);
			const { files, fields } = parseMultipart(body, req.headers['content-type'] || '');
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

await ensureWorkspace();
const server = http.createServer((req, res) => {
	void handle(req, res);
});
server.listen(PORT, HOST, () => {
	console.log(`✓ Lung Legend Lab API  http://${HOST}:${PORT}`);
	console.log(`  defaults: ${toRepoRel(DEFAULT_CUTAWAY)}`);
	console.log(`           ${toRepoRel(DEFAULT_LEGEND)}`);
});
