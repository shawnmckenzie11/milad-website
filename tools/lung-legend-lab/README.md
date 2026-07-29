# Lung Legend Lab (maintainer-only)

Standalone testing UI for legend OCR extract → observability classification →
OpenCV template-match → findings progress. **Not** part of the public Astro site.

## Run

From the repo root:

```bash
npm run lung:lab
```

- UI: http://127.0.0.1:5179
- API: http://127.0.0.1:8789

Uses `.venv-lung` via `scripts/run-lung-python.mjs`.

## MVP flow

1. Defaults load checked-in cutaway + legend (or upload replacements).
2. **Extract** → `debug/legend-extract.json`
3. Classify each item (seeded from `legend-classification.json`)
4. **Run match** → `lung:generate` + findings upsert
5. Inspect labeled findings on the cutaway; mark FP / confirm / reassign
6. Rerun and watch progress / run history

## Per-analysis isolation

`workspace/analyses/{id}/` is the store of record for an analysis: its cutaway,
legend, extract, classification, findings, match report, annotations, review
feedback, layer/glyph/freehand PNGs, style-guide snapshot and RL history.

The Python pipeline writes fixed shared paths (`public/figures/lung-health/**`,
`workspace/*.json`), so those are a **single-tenant scratch area**:

- `workspace/live-owner.json` names the one analysis holding the live lease.
- Every write from the UI snapshots into that analysis immediately; a snapshot
  for any other id is refused (this is what stops a new analysis, or a pipeline
  job that lands after you switched, from overwriting a saved analysis).
- Creating a new analysis saves the outgoing one, transfers the lease, then
  clears live state — a new analysis never inherits another's outputs.
- Layers / legend glyphs / freehand icons are served from the open analysis's own
  folder, so shared checked-in artwork cannot bleed into another session's views.
- `style-guide-profiles/` is intentionally shared: those are versioned profiles,
  not session state, and each analysis snapshots the one it is bound to.

## Test fixtures

Numbered cutaway/legend pairs live in `fixtures/` — see `fixtures/README.md`.

- **Test 1** (`test-cutaway-1.png` / `test-legend-1.png`) is the baseline pair the
  matcher is calibrated against: `public/figures/lung-health/cutaway-neutral.png`
  at **1024 × 953** plus `Lung Cutaway Legend Template.png`.
- **Test 2** (`test-cutaway-2.png` / `test-legend-2.png`) is a second pair for
  exercising the pipeline (and per-analysis isolation) end-to-end. Create a new
  analysis, then upload them in the classify step.

## Recovering the Test 1 baseline

`workspace/` is gitignored, so a deleted analysis folder cannot be restored from
git. The Test 1 *pipeline outputs* are checked in, so the baseline analysis can be
rebuilt from committed artifacts:

```bash
npm run lung:lab:recover-test1
```

This (re)creates `analysis-test1-baseline` — "Test 1 · Baseline" in the Analyses
list — with the findings DB, match report, expert annotations, outline layers and
legend crops, then releases the live lease if it was held by a missing analysis.
Idempotent; never touches other analyses. Freehand geometry ground truth is *not*
recoverable this way (it only ever lived in `workspace/`), so Tier-2 A1/B1 may
score lower on a fresh rematch than the restored snapshot shows.

## Notes

- Match crop ROIs are calibrated to the current legend; alternate uploads extract
  text but may need crop recalibration before matching is accurate.
- The matcher requires a **1024 × 953** cutaway. Its ROIs are canonical
  coordinates, so a rescaled re-export of the same artwork is rejected with an
  explanatory error rather than silently searching the wrong regions.
- Visitor `/projects` stays unchanged.
