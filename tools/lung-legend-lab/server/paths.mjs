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
 * Legacy single-tenant lease file.
 *
 * Analyses now own separate databases under `workspace/analyses/{id}/`, and the
 * pipeline takes an explicit `--io-root`, so nothing claims or waits on a lease.
 * The path survives only so `ensureWorkspace()` can migrate a pre-lease-removal
 * workspace and delete the file.
 */
export const LEGACY_LIVE_OWNER_PATH = path.join(WORKSPACE, 'live-owner.json');

/**
 * Versioned style-guide profiles (JSON + Markdown) selected per analysis.
 * Not under workspace/ so they ship with the repo.
 */
export const STYLE_GUIDE_PROFILES_DIR = path.join(LAB_ROOT, 'style-guide-profiles');

/**
 * Checked-in site figure tree.
 *
 * This is the *published* store, not scratch space for lab sessions: only an
 * explicit `npm run lung:generate` (no `--io-root`) writes it, and the lab reads
 * it when the maintainer works on defaults with no analysis bound.
 */
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

/** Legend glyph templates + pathway previews written by the matcher. */
export const TEMPLATES_DIR = path.join(FIGURES, 'templates');
export const PREVIEWS_DIR = path.join(FIGURES, 'previews');

/**
 * Site-tree store, shaped like {@link analysisPaths} so handlers can treat
 * "no analysis bound" (defaults mode) as just another store.
 *
 * Keys must stay in sync with `analysisPaths()` in `analyses.mjs` and with
 * `analysis_layout()` in `scripts/lung_io_paths.py`.
 */
export const SITE_STORE = Object.freeze({
	analysisId: null,
	root: FIGURES,
	cutaway: DEFAULT_CUTAWAY,
	legend: DEFAULT_LEGEND,
	extract: EXTRACT_JSON,
	classification: CLASSIFICATION_JSON,
	findings: FINDINGS_DB,
	matchReport: MATCH_REPORT,
	annotations: ANNOTATIONS_JSON,
	trainingFeedback: TRAINING_FEEDBACK_JSON,
	rlFeedback: RL_FEEDBACK_JSON,
	rlFeedbackMd: RL_FEEDBACK_MD,
	layers: LAYERS_DIR,
	legendItems: LEGEND_ITEMS_DIR,
	freehandIcons: FREEHAND_ICONS_DIR,
	templates: TEMPLATES_DIR,
	previews: PREVIEWS_DIR,
	debug: DEBUG_DIR,
});

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
