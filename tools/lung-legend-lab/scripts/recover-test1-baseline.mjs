/**
 * Re-seed the "Test 1" baseline analysis in the legend lab from committed artifacts.
 *
 * The lab workspace (`tools/lung-legend-lab/workspace/`) is gitignored, so an
 * analysis folder that is deleted — by hand, by a crash, or by the per-analysis
 * isolation rewrite — is not recoverable from version control. The *pipeline
 * outputs* for the Test 1 pair are checked in, though, so the baseline analysis
 * can be rebuilt from `git show HEAD:…` blobs:
 *
 *   - legend extract / classification (tier + slug assignments)
 *   - findings DB (per-code instances and tier stats)
 *   - template-match report (per-slug hits and scores)
 *   - expert hit annotations (confirms + false positives)
 *   - outline layer PNGs and legend glyph/row crops
 *
 * What cannot be recovered: freehand geometry ground truth, which only ever
 * lived in `workspace/lab-training-feedback.json` and the deleted analysis
 * folder. The *results* it produced survive in the match report, so restored
 * Tier-2 A1/B1 rows are present, but a fresh rematch without that GT may
 * under-recover those two codes. See `REPORT` output at the end of a run.
 *
 * Usage (from the repo root):
 *   node tools/lung-legend-lab/scripts/recover-test1-baseline.mjs [--id <analysis-id>] [--force]
 *
 * Idempotent: re-running refreshes the same analysis id in place. Never touches
 * any other analysis folder, and never writes the shared live pipeline paths —
 * opening the analysis in the lab is what restores it into the live workspace.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
	analysisPaths,
	updateAnalysisMeta,
	readLiveOwnerId,
	setLiveOwnerId,
} from '../server/analyses.mjs';
import {
	DEFAULT_STYLE_GUIDE_PROFILE_ID,
	writeStyleGuideSnapshot,
} from '../server/styleGuides.mjs';
import { ROOT } from '../server/paths.mjs';

/** Stable id so re-running refreshes rather than piling up duplicates. */
const DEFAULT_ID = 'analysis-test1-baseline';

/** Human-facing name shown in the lab's Analyses list. */
const ANALYSIS_NAME = 'Test 1 · Baseline';

/**
 * Canonical Test 1 input pair. `cutaway-neutral.png` is the only cutaway the
 * OpenCV matcher is calibrated for (1024×953 canonical coordinates).
 */
const TEST1_CUTAWAY = 'public/figures/lung-health/cutaway-neutral.png';
const TEST1_LEGEND = 'public/figures/lung-health/Lung Cutaway Legend Template.png';

/** Committed JSON artifacts → destination key in `analysisPaths()`. */
const JSON_ARTIFACTS = [
	['public/figures/lung-health/debug/legend-extract.json', 'extract'],
	['public/figures/lung-health/legend-classification.json', 'classification'],
	['public/figures/lung-health/debug/legend-findings-db.json', 'findings'],
	['public/figures/lung-health/debug/template-match-report.json', 'matchReport'],
	['public/figures/lung-health/debug/lab-annotations.json', 'annotations'],
];

/**
 * Read a file's committed contents at HEAD.
 * @param {string} repoRel - Repo-relative path
 * @returns {Buffer}
 */
function showAtHead(repoRel) {
	return execFileSync('git', ['show', `HEAD:${repoRel}`], {
		cwd: ROOT,
		maxBuffer: 64 * 1024 * 1024,
	});
}

/**
 * List committed file paths directly under a repo-relative directory.
 * @param {string} repoRelDir - Repo-relative directory
 * @returns {string[]}
 */
function listAtHead(repoRelDir) {
	const out = execFileSync(
		'git',
		['ls-tree', '--name-only', 'HEAD', `${repoRelDir}/`],
		{ cwd: ROOT, encoding: 'utf8' },
	);
	return out.split('\n').filter(Boolean);
}

/**
 * Write a committed blob into the analysis folder.
 * @param {string} repoRel - Repo-relative source path at HEAD
 * @param {string} dest - Absolute destination path
 * @returns {Promise<void>}
 */
async function restoreBlob(repoRel, dest) {
	await fsp.mkdir(path.dirname(dest), { recursive: true });
	await fsp.writeFile(dest, showAtHead(repoRel));
}

/**
 * Restore every committed PNG under a directory into the analysis folder.
 * @param {string} repoRelDir - Repo-relative source directory at HEAD
 * @param {string} destDir - Absolute destination directory
 * @returns {Promise<number>} Files restored
 */
async function restorePngDir(repoRelDir, destDir) {
	await fsp.mkdir(destDir, { recursive: true });
	let count = 0;
	for (const repoRel of listAtHead(repoRelDir)) {
		if (!repoRel.endsWith('.png')) continue;
		await restoreBlob(repoRel, path.join(destDir, path.basename(repoRel)));
		count += 1;
	}
	return count;
}

/**
 * Parse `--id` / `--force` flags.
 * @param {string[]} argv - Raw process args
 * @returns {{id: string, force: boolean}}
 */
function parseArgs(argv) {
	const idFlag = argv.indexOf('--id');
	return {
		id: idFlag >= 0 && argv[idFlag + 1] ? argv[idFlag + 1] : DEFAULT_ID,
		force: argv.includes('--force'),
	};
}

/**
 * Count entries in a restored artifact for the run report.
 * @param {string} filePath - Absolute JSON path
 * @param {(data: object) => number} pick - Counter
 * @returns {number}
 */
function countIn(filePath, pick) {
	try {
		return pick(JSON.parse(fs.readFileSync(filePath, 'utf8')));
	} catch {
		return 0;
	}
}

/**
 * Rebuild the Test 1 baseline analysis folder and register it in the index.
 * @returns {Promise<void>}
 */
async function main() {
	const { id, force } = parseArgs(process.argv.slice(2));
	const paths = analysisPaths(id);

	if (fs.existsSync(paths.meta) && !force) {
		console.log(`· Refreshing existing analysis ${id} (pass --force to silence)`);
	}
	await fsp.mkdir(paths.root, { recursive: true });

	await restoreBlob(TEST1_CUTAWAY, paths.cutaway);
	await restoreBlob(TEST1_LEGEND, paths.legend);
	for (const [repoRel, key] of JSON_ARTIFACTS) {
		await restoreBlob(repoRel, paths[key]);
	}
	const layerCount = await restorePngDir('public/figures/lung-health/layers', paths.layers);
	const glyphCount = await restorePngDir(
		'public/figures/lung-health/debug/legend-items',
		paths.legendItems,
	);
	await fsp.mkdir(paths.freehandIcons, { recursive: true });

	// Freehand GT is not recoverable (gitignored workspace); start from empty so
	// the restored match hits are not contested by stale outlines.
	if (!fs.existsSync(paths.trainingFeedback)) {
		await fsp.writeFile(
			paths.trainingFeedback,
			JSON.stringify({ feedback: [], updatedAt: new Date().toISOString() }, null, 2),
			'utf8',
		);
	}
	if (!fs.existsSync(paths.rlFeedbackHistory)) {
		await fsp.writeFile(paths.rlFeedbackHistory, JSON.stringify({ entries: [] }, null, 2), 'utf8');
	}
	await writeStyleGuideSnapshot(paths.styleGuide, DEFAULT_STYLE_GUIDE_PROFILE_ID);

	await updateAnalysisMeta(id, {
		name: ANALYSIS_NAME,
		phase: 'refine',
		screen: 'refine',
		refineScreen: 'database',
		tierToTest: 1,
		// Open focused on Tier 1, which is where rematch work resumes. The gate is
		// the *active* tier, not a record of completed work: `resolveActiveTierToTest`
		// heals focus up to the gate, so a gate of 3 would make Tier 1 unselectable.
		// Recovered Tier 2/3 rows still render in Database View regardless.
		maxUnlockedTier: 1,
		usingDefaults: true,
		notes: 'Test 1 baseline recovered from committed pipeline artifacts.',
		styleGuideProfileId: DEFAULT_STYLE_GUIDE_PROFILE_ID,
		hasStyleGuideSnapshot: fs.existsSync(paths.styleGuideJson),
	});

	// A lease naming an analysis that no longer exists blocks every snapshot.
	const owner = await readLiveOwnerId();
	if (owner && !fs.existsSync(analysisPaths(owner).meta)) {
		await setLiveOwnerId(null);
		console.log(`· Released dangling live lease held by missing analysis ${owner}`);
	}

	const findings = countIn(paths.findings, (d) => Object.keys(d.items || {}).length);
	const hits = countIn(paths.matchReport, (d) => Object.keys(d.layers || {}).length);
	const anns = countIn(paths.annotations, (d) => (d.annotations || []).length);
	console.log(`✓ Recovered Test 1 baseline as ${id}`);
	console.log(`  findings items ${findings} · matched layers ${hits} · annotations ${anns}`);
	console.log(`  layer PNGs ${layerCount} · legend crops ${glyphCount}`);
	console.log(`  open it in the lab: Analyses → "${ANALYSIS_NAME}"`);
}

await main();
