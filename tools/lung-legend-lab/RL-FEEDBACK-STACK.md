# RL feedback stack (maintainer)

Internal reference for **Generate Feedback Prompt** → Cursor. Executable rules live in:

- `.cursor/rules/lung-legend-rl-feedback.mdc`
- `.cursor/agents/lung-legend-rl-feedback.md`
- Builder: `src/lib/rlFeedback.ts`
- Matcher anchors: `scripts/lung_template_match.py` (`CANONICAL_SCALE_ANCHORS`)

## Why modes exist

The same paste button serves **different processes**. The header makes that unambiguous:

| MODE | Expert action | Agent job |
|------|---------------|-----------|
| `tierN-calibration` | Confirm correct hits; mark FPs | Protect TPs; kill FPs via shared OpenCV knobs |
| `tierN-geometry-gt` | Freehand misses / bad geometry | Outlines = GT; rematch across scales/locations |
| `tierN-mixed` | Both | Calibration, then geometry |
| empty / notes | Little new review | Usually no matcher edits |

`MISS_ATTRIBUTION` tells the agent whether to prefer **CV knobs** or **style-guide / legend-context** when freehand is present — you do not have to decide.

## Layered learning (three scopes)

Every prompt paste should produce work (and a summary) against these scopes:

1. **Immediate (this analysis)** — Lab already persisted confirms / FPs / freehand in the analysis folder. Prefer expert outline over purged/wrong matches for *this* run.
2. **CV revision (shared stack)** — Adjust threshold / ROI / scales / NMS / exclude / silhouette stamp so rematch recovers confirms and freehand geometry. Still template-match; never a new detector. Rematch must search **10%…200%** glyph scales and **other** ROI locations.
3. **Style / project layer** — If the miss is style-specific (linestyle, colourway, iconInterpretation), update style-guide / legend-context / agent instructions for this profile — do not hack a one-off detector.

## Tier-2 freehand-instance rematch (A1/B1 bands)

For `multiple-adjacent-as-one`, legend-glyph NCC often fails on lumen-adjacent copies even when a mid-stem hit is solid (~0.14 at A1 ~(710,219) vs ~0.47 at ~(376,71)). After expert freehand GT exists in `lab-training-feedback.json`, `lung_template_match.py` also runs `matchTemplate` with those freehand crops as extra templates (still OpenCV — not flood-fill). A B1 freehand can recover a similar A1 segment and vice versa. Keep expanded lumen-band ROIs and `max_matches` > 1.

## Freehand ↔ match reconcile

After geometry-gt rematch (automatic in lab match job via `server/freehandMatchReconcile.mjs`).
Also runs on **analysis open/restore** so stale freehand+hit duplicates heal without a rematch.

Reconcile runs **per locus**: only hits within 120px of the outline (or overlapping its bbox) are judged against it. Other instances of the same code are untouched — A1 owns both the mid-stem glyph and a lumen band.

| Verdict | Condition | Action |
|---------|-----------|--------|
| Not contesting | Centroid > 120px away and no bbox overlap | Leave the hit alone (different instance) |
| Compatible | Centroid within 40px **and** match max-side / freehand bbox max-side ∈ [0.4, 2.5] | Retire freehand to `freehand-superseded`; keep algorithm hit |
| Incompatible | Contesting but far **or** wrong shape/scale | Reject hit (`deleted` + findings scrub); keep freehand |

**Never keep both** freehand and match for the same code in the DB/UI. Centroid nearness alone is not enough (B1 tiny glyph stamp can sit near a large band centroid).

**Retire, don't delete.** A superseded outline keeps its vertices under `kind: freehand-superseded` — hidden from review UI and RL prompts, but still loaded by `load_band_freehand_templates`. Deleting it made the *next* generate lose the very hit that superseded it.

**Agent framing:** a compatible recovery is a **success** — say the freehand is superseded. Do not understate a near-perfect match (e.g. A1 ~(376,71)) as “weak” when size+centroid pass.

### Failure modes that caused A1/B1 inconsistency (do not reintroduce)

1. **Tiny wrong-shape near freehand** — NMS / secondary prior near freehand centroid accepted a small glyph stamp (B1). Mitigation: `min_component_side` on max(w,h), `tiny_scale_needs_prior`, sizeRatio gate in reconcile, `require_match=False` for hard Tier-2 bands.
2. **Duplicate freehand + hit after rematch** — reconcile only lived in the agent’s head / UI filter; persistence still had both rows. Mitigation: server reconcile after match **and** on analysis restore; client also hides superseded/incompatible.
3. **Underselling compatible A1** — rematch recovered the band well, but the RL writeup treated it as incomplete and left freehand. Mitigation: docs above — compatible ⇒ supersede freehand, report as TP keep.
4. **Cross-code template transfer assumed** — a B1 outline does *not* recover the A1 band (NCC ~0.36 off-centre vs ~0.75 for A1's own outline). Each band code generally needs its own GT; B1's legend glyph at 2.1× was what landed on A1's locus as an FP.
5. **Stale `exclude_centers` vetoing GT** — B1 could never self-match because a prior FP suppressor sat 15px from its outline centre. Mitigation: `relax_excludes_vetoing_freehand` drops priors within `exclude_radius` of the outline bbox centre.
6. **Judging a multi-instance code by `matches[0]`** — reconcile compared A1's lumen outline against whichever hit ranked first and would have rejected the valid mid-stem instance. Mitigation: contest radius (above).

## Lean prompts

Exports include only:

- `MODE` / `MODE_LABEL` / `MISS_ATTRIBUTION`
- `REF:` paths to this stack (rule, agent, skill, this doc)
- Instance-specific miss-attribution bullets (when freehand heuristics fire)
- Review delta (confirms, FPs, freehand vertices, notes)

They do **not** repeat Agent process / rematch-scale essays — agents must open REF.

## Tier difficulty

Each tier up is **much harder**, especially freehand:

- **Tier 1** — exact replicas; freehand ≈ miss or wrong peak.  
- **Tier 2** — ~70% similarity / clusters / adjacent multiples; freehand often non-replica; expect incomplete recovery and careful pending vs FP tradeoffs.  
- **Tier 3** — scale-divergent; freehand is guidance.
