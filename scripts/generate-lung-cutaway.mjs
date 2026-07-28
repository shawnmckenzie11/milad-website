#!/usr/bin/env node
/**
 * Lung cutaway layer generator — Node entry for the OpenCV template-match pipeline.
 *
 * Usage:
 *   node scripts/generate-lung-cutaway.mjs
 *   node scripts/generate-lung-cutaway.mjs --validate
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const runner = path.join(ROOT, 'scripts/run-lung-python.mjs');
const args = process.argv.slice(2);
const validateOnly = args.includes('--validate');
const pyArgs = [
	runner,
	'scripts/lung_template_match.py',
	validateOnly ? '--validate' : '--generate',
];

const result = spawnSync(process.execPath, pyArgs, {
	cwd: ROOT,
	encoding: 'utf8',
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
