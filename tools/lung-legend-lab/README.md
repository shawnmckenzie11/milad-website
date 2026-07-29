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

Those folders *are* the databases — there is no shared scratch area and no lease:

- Every UI write and every pipeline job resolves its paths from the analysis it was
  started for. Jobs bind that id at request time and pass it to Python as
  `--io-root`, so a job keeps writing its own analysis even if you open a different
  one while it runs.
- Opening or creating an analysis is a pointer move. Nothing is copied into or
  cleared out of a shared tree, so switching in the UI cannot interrupt, block, or
  overwrite work in progress on another analysis.
- Layers / legend glyphs / freehand icons are served from the open analysis's own
  folder, so one analysis's artwork cannot bleed into another's views.
- `public/figures/lung-health/**` is the **published** site tree, not scratch. Only
  a bare `npm run lung:generate` writes it; add `--analysis <id>` (or `--io-root
  <dir>`) to target an analysis instead.
- `style-guide-profiles/` is intentionally shared: those are versioned profiles,
  not session state, and each analysis snapshots the one it is bound to.

Work an analysis from the CLI without opening the lab:

```bash
npm run lung:generate -- --analysis analysis-test1-baseline
node scripts/run-lung-python.mjs scripts/lung_legend_observability.py --extract-only \
  --io-root tools/lung-legend-lab/workspace/analyses/analysis-test1-baseline
```

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
legend crops. Idempotent; never touches other analyses. Freehand geometry ground
truth is *not* recoverable this way (it only ever lived in `workspace/`), so Tier-2
A1/B1 may score lower on a fresh rematch than the restored snapshot shows.

## Notes

- Match crop ROIs are calibrated to the current legend; alternate uploads extract
  text but may need crop recalibration before matching is accurate.
- The matcher requires a **1024 × 953** cutaway. Its ROIs are canonical
  coordinates, so a rescaled re-export of the same artwork is rejected with an
  explanatory error rather than silently searching the wrong regions.
- Visitor `/projects` stays unchanged.
