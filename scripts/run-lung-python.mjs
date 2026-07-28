#!/usr/bin/env node
/**
 * Shared Node entry that bootstraps .venv-lung and runs a lung Python script.
 *
 * Usage:
 *   node scripts/run-lung-python.mjs scripts/lung_template_match.py --generate
 *   node scripts/run-lung-python.mjs scripts/lung_legend_observability.py --self-test
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VENV_PYTHON = path.join(ROOT, '.venv-lung/bin/python');
const REQUIREMENTS = path.join(ROOT, 'scripts/requirements-lung.txt');

/**
 * Resolve a Python interpreter that can import the lung pipeline deps.
 * @returns {string}
 */
function resolvePython() {
	if (existsSync(VENV_PYTHON)) return VENV_PYTHON;
	return process.env.LUNGP_PYTHON || process.env.PYTHON || 'python3';
}

/**
 * Ensure opencv / numpy / pytesseract are importable; create venv if needed.
 * @param {string} python
 * @returns {string}
 */
function ensureDeps(python) {
	const probe = spawnSync(python, ['-c', 'import cv2, numpy, pytesseract'], {
		encoding: 'utf8',
	});
	if (probe.status === 0) return python;

	console.log('· Lung Python deps missing — bootstrapping .venv-lung…');
	const venvPy = path.join(ROOT, '.venv-lung/bin/python');
	if (!existsSync(venvPy)) {
		const created = spawnSync('python3', ['-m', 'venv', path.join(ROOT, '.venv-lung')], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: 'inherit',
		});
		if (created.status !== 0) {
			console.error('✗ Failed to create .venv-lung');
			process.exit(1);
		}
	}
	const pip = spawnSync(venvPy, ['-m', 'pip', 'install', '-r', REQUIREMENTS], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: 'inherit',
	});
	if (pip.status !== 0) {
		console.error('✗ Failed to install scripts/requirements-lung.txt');
		process.exit(1);
	}
	const reprobe = spawnSync(venvPy, ['-c', 'import cv2, numpy, pytesseract'], {
		encoding: 'utf8',
	});
	if (reprobe.status !== 0) {
		console.error('✗ Lung Python deps still unavailable after install');
		process.exit(1);
	}
	return venvPy;
}

/**
 * Run the requested Python script with remaining argv.
 */
function main() {
	const [scriptRel, ...scriptArgs] = process.argv.slice(2);
	if (!scriptRel) {
		console.error('Usage: node scripts/run-lung-python.mjs <script.py> [args...]');
		process.exit(1);
	}
	const scriptPath = path.isAbsolute(scriptRel) ? scriptRel : path.join(ROOT, scriptRel);
	if (!existsSync(scriptPath)) {
		console.error(`✗ Missing script: ${scriptPath}`);
		process.exit(1);
	}
	const python = ensureDeps(resolvePython());
	console.log(`✓ Running ${path.relative(ROOT, scriptPath)} via ${python}`);
	const result = spawnSync(python, [scriptPath, ...scriptArgs], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: 'inherit',
	});
	if (result.error) {
		console.error(result.error);
		process.exit(1);
	}
	process.exit(result.status ?? 1);
}

main();
