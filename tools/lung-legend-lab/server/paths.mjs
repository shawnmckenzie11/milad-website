/**
 * Resolve filesystem paths for the lung legend lab API relative to the repo root.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the milad-website repository root. */
export const ROOT = path.resolve(__dirname, '../../..');

/** Lab package root (`tools/lung-legend-lab`). */
export const LAB_ROOT = path.resolve(__dirname, '..');

/** Writable session workspace for uploads + session.json. */
export const WORKSPACE = path.join(LAB_ROOT, 'workspace');

/** Session pointer file (active cutaway/legend paths). */
export const SESSION_PATH = path.join(WORKSPACE, 'session.json');

/**
 * Lease file naming the single analysis that currently owns the shared live
 * pipeline paths (`public/figures/lung-health/**` + `workspace/*`).
 *
 * The Python pipeline writes fixed shared paths, so exactly one analysis may be
 * "live" at a time. Every snapshot back into an analysis folder is gated on this
 * lease, which is what stops a new/other analysis from writing its results (or
 * an empty stub) into a previously saved analysis.
 */
export const LIVE_OWNER_PATH = path.join(WORKSPACE, 'live-owner.json');

/**
 * Versioned style-guide profiles (JSON + Markdown) selected per analysis.
 * Not under workspace/ so they ship with the repo.
 */
export const STYLE_GUIDE_PROFILES_DIR = path.join(LAB_ROOT, 'style-guide-profiles');
export const FIGURES = path.join(ROOT, 'public/figures/lung-health');
export const DEBUG_DIR = path.join(FIGURES, 'debug');
export const LAYERS_DIR = path.join(FIGURES, 'layers');

export const DEFAULT_CUTAWAY = path.join(FIGURES, 'cutaway-neutral.png');
export const DEFAULT_LEGEND = path.join(FIGURES, 'Lung Cutaway Legend Template.png');

export const EXTRACT_JSON = path.join(DEBUG_DIR, 'legend-extract.json');
export const CLASSIFICATION_JSON = path.join(FIGURES, 'legend-classification.json');
export const FINDINGS_DB = path.join(DEBUG_DIR, 'legend-findings-db.json');
export const MATCH_REPORT = path.join(DEBUG_DIR, 'template-match-report.json');
export const ANNOTATIONS_JSON = path.join(DEBUG_DIR, 'lab-annotations.json');

/** Live extracted legend glyph/row crops (snapshotted per analysis). */
export const LEGEND_ITEMS_DIR = path.join(DEBUG_DIR, 'legend-items');

/** Live tier-2 geometry / review feedback (snapshotted per analysis). */
export const TRAINING_FEEDBACK_JSON = path.join(WORKSPACE, 'lab-training-feedback.json');

/** Legend-style PNG thumbnails for freehand classifications. */
export const FREEHAND_ICONS_DIR = path.join(WORKSPACE, 'freehand-icons');

/** Latest exported RL feedback prompt + delta cursor. */
export const RL_FEEDBACK_JSON = path.join(WORKSPACE, 'rl-feedback.json');
export const RL_FEEDBACK_MD = path.join(WORKSPACE, 'rl-feedback-prompt.md');

export const RUN_LUNG_PYTHON = path.join(ROOT, 'scripts/run-lung-python.mjs');
export const OBSERVABILITY_PY = path.join(ROOT, 'scripts/lung_legend_observability.py');
export const TEMPLATE_MATCH_PY = path.join(ROOT, 'scripts/lung_template_match.py');
export const FINDINGS_DB_PY = path.join(ROOT, 'scripts/lung_findings_db.py');

/**
 * Convert an absolute path under ROOT into a repo-relative POSIX path.
 * @param {string} abs
 * @returns {string}
 */
export function toRepoRel(abs) {
	return path.relative(ROOT, abs).split(path.sep).join('/');
}
