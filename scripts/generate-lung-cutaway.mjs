#!/usr/bin/env node
/**
 * Lung cutaway layer generator — Node entry for the OpenCV template-match pipeline.
 *
 * Usage:
 *   node scripts/generate-lung-cutaway.mjs                        # published site assets
 *   node scripts/generate-lung-cutaway.mjs --validate
 *   node scripts/generate-lung-cutaway.mjs --analysis <id>        # one lab analysis
 *   node scripts/generate-lung-cutaway.mjs --io-root <dir>        # any private dir
 *
 * Without `--analysis` / `--io-root` this regenerates the checked-in figure
 * assets and `lungHealthLayers.generated.ts`. With one of them, every read and
 * write stays inside that analysis folder, so a run for one analysis cannot
 * disturb another analysis (or the site) even while the lab is switching
 * sessions.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANALYSES_DIR = path.join(ROOT, 'tools/lung-legend-lab/workspace/analyses');
const runner = path.join(ROOT, 'scripts/run-lung-python.mjs');

/**
 * Read a `--flag value` pair from argv.
 * @param {string[]} argv - Raw CLI args
 * @param {string} flag - Flag name including dashes
 * @returns {string | null} The value, or null when the flag is absent
 */
function flagValue(argv, flag) {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/**
 * Resolve the IO root for this run from `--analysis` / `--io-root`.
 * @param {string[]} argv - Raw CLI args
 * @returns {string | null} Absolute directory, or null for the site tree
 */
function resolveIoRoot(argv) {
	const explicit = flagValue(argv, '--io-root');
	if (explicit) return path.resolve(ROOT, explicit);
	const analysisId = flagValue(argv, '--analysis');
	if (!analysisId) return null;
	if (analysisId.includes('/') || analysisId.includes('..')) {
		console.error(`✗ Invalid analysis id: ${analysisId}`);
		process.exit(1);
	}
	const dir = path.join(ANALYSES_DIR, analysisId);
	if (!fs.existsSync(path.join(dir, 'meta.json'))) {
		console.error(`✗ No analysis ${analysisId} under ${path.relative(ROOT, ANALYSES_DIR)}`);
		process.exit(1);
	}
	return dir;
}

const args = process.argv.slice(2);
const validateOnly = args.includes('--validate');
const ioRoot = resolveIoRoot(args);
const pyArgs = [
	runner,
	'scripts/lung_template_match.py',
	validateOnly ? '--validate' : '--generate',
	...(ioRoot ? ['--io-root', ioRoot] : []),
];

if (ioRoot) {
	console.log(`· Analysis-scoped run → ${path.relative(ROOT, ioRoot)}`);
} else {
	console.log('· Site run → public/figures/lung-health (published assets)');
}

const result = spawnSync(process.execPath, pyArgs, {
	cwd: ROOT,
	encoding: 'utf8',
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
