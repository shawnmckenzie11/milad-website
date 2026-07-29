/**
 * In-memory job runner for long-lived lung Python pipeline steps.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** @typedef {'queued' | 'running' | 'succeeded' | 'failed'} JobStatus */

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {string} kind
 * @property {JobStatus} status
 * @property {string[]} log
 * @property {number | null} exitCode
 * @property {string | null} error
 * @property {string} startedAt
 * @property {string | null} finishedAt
 * @property {Record<string, unknown>} meta
 */

/** @type {Map<string, Job>} */
const jobs = new Map();

/**
 * Create a job record in queued state.
 * @param {string} kind
 * @param {Record<string, unknown>} [meta]
 * @returns {Job}
 */
export function createJob(kind, meta = {}) {
	const job = {
		id: randomUUID(),
		kind,
		status: /** @type {JobStatus} */ ('queued'),
		log: [],
		exitCode: null,
		error: null,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		meta,
	};
	jobs.set(job.id, job);
	return job;
}

/**
 * Look up a job by id.
 * @param {string} id
 * @returns {Job | undefined}
 */
export function getJob(id) {
	return jobs.get(id);
}

/**
 * Strip ASCII control characters so job logs stay JSON-safe.
 * @param {string} line
 * @returns {string}
 */
function sanitizeLogLine(line) {
	return String(line)
		.replace(/\r/g, '')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.trimEnd();
}

/**
 * Append a log line and trim to a bounded history.
 * @param {Job} job
 * @param {string} line
 */
function pushLog(job, line) {
	const cleaned = sanitizeLogLine(line);
	if (!cleaned) return;
	job.log.push(cleaned);
	if (job.log.length > 400) {
		job.log.splice(0, job.log.length - 400);
	}
}

/**
 * Best-effort human-readable reason for a failed pipeline step.
 *
 * The Python steps report actionable diagnostics on stderr as `✗ …` lines and
 * then exit non-zero. Reporting only `exit 1` in the UI hides that message
 * behind the collapsed job log, so prefer the last failure line when present.
 *
 * @param {string[]} stderrLines - Captured stderr lines, oldest first
 * @param {number} code - Process exit code
 * @returns {string}
 */
function describeFailure(stderrLines, code) {
	const marked = stderrLines.filter((line) => line.startsWith('✗'));
	const detailBullets = stderrLines.filter((line) => /^\s+-\s+/.test(line));
	const candidates = marked.length > 0 ? marked : stderrLines;
	const reason = candidates[candidates.length - 1];
	// #region agent log
	fetch('http://127.0.0.1:7868/ingest/724760d6-ef5a-4796-9efe-f15dc9586e38', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Debug-Session-Id': 'df4dd8',
		},
		body: JSON.stringify({
			sessionId: 'df4dd8',
			runId: 'post-fix',
			hypothesisId: 'H4',
			location: 'jobs.mjs:describeFailure',
			message: 'UI failure reason selection',
			data: {
				code,
				stderrCount: stderrLines.length,
				marked,
				detailBullets,
				chosenReason: reason || null,
				omitsDetails: marked.length > 0 && detailBullets.length > 0,
			},
			timestamp: Date.now(),
		}),
	}).catch(() => {});
	// #endregion
	if (!reason) return `exit ${code}`;
	const header = reason.replace(/^✗\s*/, '');
	if (detailBullets.length > 0) {
		const details = detailBullets.map((line) => line.replace(/^\s+-\s+/, '').trim()).join('; ');
		return `${header} ${details} (exit ${code})`;
	}
	return `${header} (exit ${code})`;
}

/**
 * Spawn a child process, streaming stdout/stderr into the job log.
 * @param {Job} job
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<Job>}
 */
export function runProcessJob(job, command, args, cwd) {
	return new Promise((resolve) => {
		job.status = 'running';
		pushLog(job, `$ ${command} ${args.join(' ')}`);
		/** Stderr only, so the failure reason is not diluted by progress output. */
		const stderrLines = [];

		const child = spawn(command, args, {
			cwd,
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		child.stdout.on('data', (buf) => {
			for (const line of String(buf).split('\n')) pushLog(job, line);
		});
		child.stderr.on('data', (buf) => {
			for (const line of String(buf).split('\n')) {
				const cleaned = sanitizeLogLine(line);
				if (cleaned) stderrLines.push(cleaned);
				pushLog(job, line);
			}
		});

		child.on('error', (err) => {
			job.status = 'failed';
			job.error = err.message;
			job.finishedAt = new Date().toISOString();
			pushLog(job, `✗ spawn error: ${err.message}`);
			resolve(job);
		});

		child.on('close', (code) => {
			job.exitCode = code ?? 1;
			job.finishedAt = new Date().toISOString();
			if (code === 0) {
				job.status = 'succeeded';
				pushLog(job, '✓ job finished');
			} else {
				job.status = 'failed';
				job.error = describeFailure(stderrLines, job.exitCode);
				pushLog(job, `✗ job failed (exit ${code})`);
			}
			resolve(job);
		});
	});
}

/**
 * Serialize a job for JSON responses (full log for small UIs).
 * @param {Job} job
 * @returns {object}
 */
export function serializeJob(job) {
	return {
		id: job.id,
		kind: job.kind,
		status: job.status,
		exitCode: job.exitCode,
		error: job.error,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		meta: job.meta,
		log: job.log,
		logTail: job.log.slice(-40),
	};
}
