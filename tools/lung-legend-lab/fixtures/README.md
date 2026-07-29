# Legend lab test image pairs

Reference cutaway + legend pairs for the lung legend lab. Each numbered pair is a
self-contained test case: load it as a new analysis and the per-analysis lease
(`workspace/live-owner.json`) keeps its pipeline outputs isolated from the others.

| Pair | Cutaway | Legend | Cutaway canvas |
| --- | --- | --- | --- |
| **Test 1** (baseline) | `test-cutaway-1.png` | `test-legend-1.png` | 1024 × 953 |
| **Test 2** | `test-cutaway-2.png` | `test-legend-2.png` | 1024 × 866 |

## Test 1 — baseline

The canonical pair all prior Tier-1/2/3 work was calibrated against.
Byte-identical copies of the checked-in production assets:

- `test-cutaway-1.png` ← `public/figures/lung-health/cutaway-neutral.png`
- `test-legend-1.png` ← `public/figures/lung-health/Lung Cutaway Legend Template.png`

`cutaway-neutral.png` is the authoritative Test 1 cutaway. Other similar-looking
uploads (re-exports at 1070 × 996, or `Lung Basic`-named copies) are **not** the
baseline and must not be substituted.

This is the pair the OpenCV template matcher in `scripts/lung_template_match.py`
is calibrated against. Every ROI, exclude center, and scale anchor in
`LAYER_SPECS` is expressed in **1024 × 953** cutaway coordinates
(`CANVAS_W` / `CANVAS_H`), so Test 1 must be fed at exactly that size. A
re-exported or rescaled copy of the same artwork is *not* interchangeable — the
matcher rejects it rather than silently searching the wrong regions.

Tier-1/2/3 results for this pair are the reference numbers used when judging a
rematch regression; see `public/figures/lung-health/debug/template-match-report.json`.

## Test 2

Second pair with a shorter cutaway and a narrower legend. Kept to prove
per-analysis isolation: running Test 2 must not overwrite Test 1's findings,
layers, or match report.

## Note on file extensions

`test-cutaway-1.png` and `test-cutaway-2.png` carry a `.png` extension but are
JPEG-encoded (same as the checked-in `cutaway-neutral.png`). OpenCV and the lab
upload path both sniff content rather than trusting the extension, so this is
harmless — do not "fix" it by re-encoding, which would change the pixels the
matcher is calibrated against.
