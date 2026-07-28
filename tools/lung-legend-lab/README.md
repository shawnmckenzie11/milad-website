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

## Notes

- Match crop ROIs are calibrated to the current legend; alternate uploads extract
  text but may need crop recalibration before matching is accurate.
- Visitor `/projects` stays unchanged.
