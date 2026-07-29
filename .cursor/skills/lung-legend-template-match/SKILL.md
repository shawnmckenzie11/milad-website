---
name: lung-legend-template-match
description: >-
  OpenCV multi-scale legend template-matching for lung cutaway highlights.
  Use when calibrating lungHealth layers, running lung:generate / lung:validate-layers,
  fixing cutaway outline fidelity, or when tempted to reinvent flood-fill / chroma
  segmentation against cutaway-neutral.png.
---

# Lung legend template match

Sole detection method for searchable cutaway layers (observability tiers 1–3).

## Standard stack (do not invent alternatives)

1. **Crop legend glyphs once** from `public/figures/lung-health/Lung Cutaway Legend Template.png` into `public/figures/lung-health/templates/{slug}.png` (alpha = ink; white card → transparent). For `iconInterpretation=2-discrete`, crop **two** part templates (`{slug}--{part}.png`) and search each independently. Start with B3/B4/B5/B9; then B6/B7/A1/B1; then A2/A3.
2. **`cv2.matchTemplate` multi-scale** (`TM_CCOEFF_NORMED`) inside lumen / junction (and main-tree) ROIs on `cutaway-neutral.png`.
3. **Threshold by tier** → stamp the matched template silhouette (connected ink) at the hit. Keep additional peaks via NMS + optional `min_score_secondary` near `expected_centers`.
4. **Emit** `layers/{slug}.png` + `layers/{slug}-outline.png` and **fail CI** if verify composites / outline alpha do not overlap the match center.
5. **Runtime stays:** original `cutaway-neutral.png` + outline overlays only (`LungHealthCutaway.tsx`). Debug/verify composites label each match with legend code + score.

Same pipeline for every searchable layer; **only confidence, ROI, scale sweep, and iconInterpretation differ**.

## Forbidden

- Flood-fill / chroma / seed recipes as the primary detector
- Replacing the artwork with a schematic SVG
- Same-pixel extracts without outlines (invisible on the source PNG)
- Shipping knowing B9 landed on the B6 5-dot cluster (~757,113) instead of the spiked virus (~676,116)

## Commands

```bash
npm run lung:extract-legend    # OCR LAYER MAP rows → debug/legend-extract.json
npm run lung:classify-legend   # self-test extract + known tier/sub-tier fixtures
npm run lung:generate          # also upserts findings DB + maintainer canvas
npm run lung:findings          # refresh findings DB from latest match report
npm run lung:validate-layers
npm run lung:lab:install       # once: deps for maintainer lab UI
npm run lung:lab               # standalone maintainer UI (extract/classify/match/findings)
```

Entry: `scripts/run-lung-python.mjs` → `lung_legend_observability.py` / `lung_template_match.py` / `lung_findings_db.py` (venv `.venv-lung`, `scripts/requirements-lung.txt`).

### Maintainer lab UI (`lung:lab`)

Standalone Vite + React app + local Node API (not public `/projects`):

- Path: `tools/lung-legend-lab/`
- UI: http://127.0.0.1:5179 · API: http://127.0.0.1:8789
- **Home:** load a saved analysis or start new
- **New analysis:** upload cutaway + legend → extract → classification wizard (tier / subTier / iconInterpretation) — classification is **not** on the refine dashboard
- **Refine:** full-bleed cutaway, **view by layer** chips, Run match, findings/progress, Confirm/FP/Reassign
- Persisted analyses: `tools/lung-legend-lab/workspace/analyses/{id}/` (images + extract/classification/match/findings/layers snapshots)
- Current cutaway is seeded as `lung-cutaway-neutral`
- **Style guide profiles:** after upload (and on the current cutaway), pick a profile from `tools/lung-legend-lab/style-guide-profiles/` (default `milad-lab-biomedical-illustration`). Bound on analysis `meta.styleGuideProfileId`. Agent consistency rule: `.cursor/rules/lung-biomedical-illustration.mdc`.

### Legend classification

For the **current** checked-in legend, classifications are owner-known — do **not** re-prompt. Run `npm run lung:classify-legend` to extract linear legend names and verify them against `legend-classification.json` / `KNOWN_CLASSIFICATION` in `scripts/lung_legend_observability.py`.

Each item also stores **`iconInterpretation`**:
- `1-discrete` — single glyph template
- `2-discrete` — two different glyphs side-by-side in one legend row (e.g. B6 dots + antibody-Y); search each independently
- `multiple-adjacent-as-one` — adjacent multiples treated as one template (A1/B1 style)

Interactive `--prompt` (future legends only) asks tier, subTier, **and** iconInterpretation.

### Findings database + canvas

Durable match/classification history lives at `public/figures/lung-health/debug/legend-findings-db.json` (upserted by `lung:generate`, `lung:classify-legend`, and `lung:findings`). Preserves `firstFoundAt` / `cumulativeFindCount` across runs; latest `instanceCount` always comes from `template-match-report.json` (never hardcode counts).

Maintainer Cursor Canvas (embedded snapshot; not visitor-facing):  
`~/.cursor/projects/Users-shawnscomputer-Documents-milad-website/canvases/lung-legend-findings.canvas.tsx`  
Refresh with `npm run lung:findings` after generate (or let generate rewrite it).

## ROIs (1024×953)

| ROI | Approx bounds | Use |
|-----|---------------|-----|
| Lumen inset | x 640–970, y 60–380 | Cells / mediators / virus |
| Virus zone | x 610–720, y 70–155 | B9 only (excludes B6 dots ~757,113) |
| Mediator zone | x 720–920, y 90–160 | B6 only (excludes FP ~874,190) |
| Signaling lumen | x 820–930, y 280–350 | B7 lumen confirm ~878,311 |
| Junction inset | x 340–700, y 660–935 | B3/B4/B5/B7 |
| Mid trachea / A1 band | x 310–450, y 20–200 | A1 stem glyph recovery (~376,71) |
| Lumen band corridor | x 520–800, y 100–320 | A1/B1 adjacent lining bands; freehand-instance rematch |
| Epithelium band / B1 | x 530–690, y 110–280 | B1 lining; also searched via freehand-instance templates |
| Main tree | x 180–860, y 40–620 | A2 |

## Tier thresholds (guidance)

| Tier | Codes | Score band | Notes |
|------|-------|------------|-------|
| 1 | B3, B4, B5, B9 | ≥ ~0.78–0.80 | Exact legend replicas in insets |
| 2 | B6, B7, A1, B1 | medium | Partial similarity / scale gap |
| 3 | A2, A3 | lower + wider scales | Hard / scale-divergent |
| 0 | A4, B2, B8 | skip | Not searchable |

## Implementation notes that already burned us

- **Masked** `matchTemplate` under-scores true hits here — match on color/gray (optional channel boost); use **alpha only for silhouette stamping**.
- Tight crop B3 (`neutrophils`); legend white padding destroys NCC.
- Reject match windows larger than the layer’s `max_component_side` before NMS.
- Reject undersized windows with `min_component_side` on **max(w,h)** (tiny B1 glyph stamps near large freehand centroids).
- Outline QA: opaque outline pixels must exist within ~18px of each accepted match center.
- After geometry-gt rematch: **reconcile** freehand vs hits (centroid + sizeRatio) — never keep both; compatible A1-class recoveries supersede freehand. Lab runs reconcile after match **and** on analysis restore (`server/freehandMatchReconcile.mjs`).
- Reconcile is **per locus**: only hits within `FREEHAND_MATCH_CONTEST_DIST` (or overlapping the outline bbox) are judged against an outline. A1 legitimately owns both the mid-stem glyph and a lumen band — never reject a distant instance against a different instance's GT.
- Superseded outlines are **retired, not deleted** (`kind: freehand-superseded`, vertices kept). They stay the matcher's band template source, so the next `lung:generate` reproduces the hit that superseded them.
- Expert GT outranks stale `exclude_centers`: a prior within `exclude_radius` of an outline's bbox center is dropped for that code (a leftover ~(610,178) suppressor silently blocked B1 from ever self-matching).
- Freehand overlays use the same yellow/`OUTLINE_STROKE_PX` language as `{slug}-outline.png` (`tools/lung-legend-lab/src/lib/outlineStyle.ts`).

## Verify artifacts (read these yourself)

- `public/figures/lung-health/debug/verify-viruses.png`
- `public/figures/lung-health/debug/verify-b9-crop.png` — outline on spiked virus
- `public/figures/lung-health/debug/verify-cigarette.png` — B3/B4/B7
- `public/figures/lung-health/debug/verify-b5-crop.png` — dendritic star
- `public/figures/lung-health/debug/verify-a1-b1-band-crop.png` — A1 mid-stem + A1/B1 lumen bands (Tier-2 freehand-instance recovery)
- `public/figures/lung-health/debug/template-match-report.json`
- `public/figures/lung-health/debug/legend-findings-db.json` — durable classification + match findings DB

## Agent

- Layer / generate specialist: `.cursor/agents/lung-cutaway-layers.md`
- **RL feedback paste specialist:** `.cursor/agents/lung-legend-rl-feedback.md`
- Process rule (MODE clarity + tier difficulty): `.cursor/rules/lung-legend-rl-feedback.mdc`
- Maintainer summary: `tools/lung-legend-lab/RL-FEEDBACK-STACK.md`

## RL feedback prompts (Generate Feedback Prompt → Cursor)

Each copied prompt starts with an unambiguous header the agent **must** obey (full process in the rule/agent above):

| Header | Meaning |
|--------|---------|
| `MODE: tier1-calibration` / `tier2-calibration` | Confirms + FPs (+ reclass). Protect TP centers; suppress FP centers via threshold / ROI / NMS / exclude. No new detector. |
| `MODE: tier1-geometry-gt` / `tier2-geometry-gt` | Freehand outlines are silhouette GT (misses / bad geometry). Rematch to recover them via scales / ROI / threshold / NMS / stamps. |
| `MODE: tierN-mixed` | Calibration first, then geometry-gt for freehand codes. |
| `MISS_ATTRIBUTION: cv-calibration \| style-guide \| ambiguous` | Heuristic when freehand present — expert need not decide. Prefer style-guide / legend-context when notes mention colour/linestyle/iconInterpretation or many codes miss on new artwork; otherwise CV-first. |
| `REMATCH_SCALES_REQUIRED` | After CV revision, search **other locations** at **10%, 25%, 50%, 75%, 100%, 125%, 150%, 200%** of glyph size (`CANONICAL_SCALE_ANCHORS` in `lung_template_match.py`). |

**Tier difficulty:** Tier 2 (and above) is orders of magnitude harder than Tier 1 — especially freehand. Do not treat Tier 2 as “Tier 1 with a lower threshold.”

**After every paste:** reply with the mandatory **RL pass summary** (<500 words) covering Immediate / CV / Style scopes — see `.cursor/rules/lung-legend-rl-feedback.mdc`. Prompts are lean (MODE + delta + REF); do not expect restated process boilerplate in the paste.

Still: same OpenCV template-match pipeline only. Do not invent flood-fill / chroma detectors.