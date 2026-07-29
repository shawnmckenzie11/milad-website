/**
 * Re-clean persisted freehand-classify outlines with atlas Chaikin/Laplacian
 * smoothing (legend-icon edge character). Updates live workspace feedback and
 * optionally an analysis snapshot.
 *
 * Run from repo root:
 *   node --experimental-strip-types tools/lung-legend-lab/scripts/reclean-freehands.mts
 *   node --experimental-strip-types tools/lung-legend-lab/scripts/reclean-freehands.mts analysis-28993c9f
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	atlasSmoothClosedOutline,
	cleanFreehandOutline,
} from '../src/lib/freehandGeometry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(__dirname, '..');

/**
 * Apply contour clean + atlas smooth to one freehand entry.
 * @param entry - Training feedback row
 * @param iconInterpretation - Optional legend interpretation for band strength
 */
function recleanEntry(
	entry: {
		id?: string;
		kind?: string;
		code?: string;
		points?: Array<{ x: number; y: number }>;
		score?: number;
		name?: string;
	},
	iconInterpretation: string | null,
): { updated: boolean; before: number; after: number; skipped?: string } {
	const pts = entry.points;
	if (!Array.isArray(pts) || pts.length < 3) {
		return { updated: false, before: 0, after: 0, skipped: 'no points' };
	}
	const before = pts.length;
	const result = cleanFreehandOutline(pts);
	if (result.needsManualClose) {
		entry.score = 1;
		return {
			updated: false,
			before,
			after: before,
			skipped: `manual close gap=${result.gap.toFixed(1)}`,
		};
	}
	const smoothed = atlasSmoothClosedOutline(result.points, {
		iconInterpretation,
	});
	entry.points = smoothed;
	entry.score = 1;
	return { updated: true, before, after: smoothed.length };
}

/**
 * Load legend-classification iconInterpretation map when present.
 * @param classificationPath - Path to legend-classification.json
 */
function loadIconMap(classificationPath: string): Map<string, string> {
	const map = new Map<string, string>();
	try {
		const doc = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));
		const items =
			doc.classifications || doc.items || (typeof doc === 'object' ? doc : null);
		if (items && typeof items === 'object') {
			for (const [code, row] of Object.entries(items)) {
				if (!row || typeof row !== 'object') continue;
				const icon = (row as { iconInterpretation?: string }).iconInterpretation;
				if (typeof icon === 'string') map.set(code, icon);
			}
		}
	} catch {
		/* optional */
	}
	// Known Tier-2 bands when classification is missing.
	if (!map.has('B1')) map.set('B1', 'multiple-adjacent-as-one');
	if (!map.has('A1')) map.set('A1', 'multiple-adjacent-as-one');
	return map;
}

/**
 * Rewrite freehands in one feedback JSON file.
 * @param feedbackPath - lab-training-feedback.json
 * @param classificationPath - optional classification for iconInterpretation
 */
function processFile(feedbackPath: string, classificationPath: string | null) {
	if (!fs.existsSync(feedbackPath)) {
		console.warn(`missing ${feedbackPath}`);
		return;
	}
	const iconMap = loadIconMap(
		classificationPath || path.join(path.dirname(feedbackPath), 'legend-classification.json'),
	);
	const data = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
	const list = Array.isArray(data.feedback) ? data.feedback : [];
	let updated = 0;

	for (const entry of list) {
		if (entry.kind !== 'freehand-classify') continue;
		const icon = iconMap.get(entry.code) || null;
		const res = recleanEntry(entry, icon);
		if (res.skipped) {
			console.warn(`skip ${entry.id}: ${res.skipped}`);
			continue;
		}
		if (!res.updated) continue;
		updated += 1;
		console.log(
			`${entry.id} (${entry.code}): ${res.before} → ${res.after} pts` +
				` icon=${icon || '—'}`,
		);
	}

	data.updatedAt = new Date().toISOString();
	fs.writeFileSync(feedbackPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
	console.log(`done: updated ${updated} freehand(s) → ${feedbackPath}`);
}

/**
 * CLI entry: optional analysis id argument.
 */
function main() {
	const analysisId = process.argv[2] || null;
	const liveFeedback = path.join(labRoot, 'workspace/lab-training-feedback.json');
	const liveClass = path.resolve(
		labRoot,
		'../../public/figures/lung-health/legend-classification.json',
	);
	processFile(liveFeedback, liveClass);

	if (analysisId) {
		const ap = path.join(
			labRoot,
			'workspace/analyses',
			analysisId,
			'lab-training-feedback.json',
		);
		const ac = path.join(
			labRoot,
			'workspace/analyses',
			analysisId,
			'legend-classification.json',
		);
		processFile(ap, ac);
	} else {
		// Also refresh the active analysis that still has B1 freehand when present.
		const defaultAnalysis = path.join(
			labRoot,
			'workspace/analyses/analysis-28993c9f/lab-training-feedback.json',
		);
		if (fs.existsSync(defaultAnalysis)) {
			processFile(
				defaultAnalysis,
				path.join(
					labRoot,
					'workspace/analyses/analysis-28993c9f/legend-classification.json',
				),
			);
		}
	}
}

main();
