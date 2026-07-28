# Lung health visualization — Phase 2 plan

Prerequisite: Phase 1 outdoor scene + calibrated bubble hotspots approved.

## Deliverable

Zoom/transition from the outdoor Ottawa scene into **one shared** schematic lung/airway cutaway when a pathway is selected. Same cutaway for all five pathways. No per-pathway cellular highlights yet (Phase 3).

## Asset strategy (locked for this phase)

- **Shared cutaway:** hand-built SVG schematic in the site’s figure grammar (flat fills, clean strokes, Montserrat labels — same as `active-programs-overview.svg`).
- **Not used:** AI-generated anatomy, five separate pathway illustrations, or the Projects inhale-path map (`airway-scene.svg`) as the cutaway.
- **Phase 3 prep:** SVG groups carry stable `data-highlight` ids so highlight layers can toggle without swapping the whole diagram.
- Final art refinements welcome after the transition feel is approved; do not batch-generate pathway states.

## Scope

- Selecting a hotspot zooms toward that bubble, then reveals the shared cutaway.
- Caption panel continues to show the locked pathway caption.
- “Back to outdoor scene” returns to the Ottawa view.
- Framer Motion for the transition; honor `prefers-reduced-motion`.
- Remove Phase 1 calibration UI.

## Out of scope

| Phase | Status |
|---|---|
| 3 — Per-pathway cellular highlights | Deferred until Phase 2 transition approved |
| 4 — Methods annotation layer | Deferred |
| 5 — Polish / publication links | Deferred |

## Checkpoint

Stop after Phase 2 ships. Review transition speed, easing, and camera behavior before Phase 3.
