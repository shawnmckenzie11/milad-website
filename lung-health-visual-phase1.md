# Lung health visualization — Phase 1 plan

Prerequisite: Phase 0 content lock in [`src/data/lungHealthVisual.ts`](src/data/lungHealthVisual.ts) (bacteria swapped for vaping). Do not start Phase 1 implementation until this plan is explicitly approved.

## Deliverable

Static outdoor Ottawa scene + five hotspots (placeholder shapes), caption panel layout, **no anatomy zoom**. Goal: validate interaction pattern and copy layout only.

## Scope

- Add `@astrojs/react`, React, and `framer-motion` to the Astro site.
- Build one React island (`client:load`), e.g. `src/components/LungHealthVisual.tsx`.
- Drive labels/captions from `lungHealthVisual` data — no hardcoded pathway copy in JSX.
- Mount on `/projects` above program cards (Phase 1 briefly used a `/visualization` review tab; that route now redirects).
- Outdoor scene asset: `public/images/initial-scene.png` (copy from `public/images/Initial Scene.png` via `scripts/use-initial-scene.sh`). The five illustrated bubbles are the clickable/keyboard hotspots (percentage centers in `lungHealthVisual.scene.hotspots`).
- Propose Phase 2–3 cutaway/highlight asset strategy before generating final anatomy art.
- Keyboard focusable hotspots; selected pathway shows its locked caption beside/below the scene.
- No shared lung cutaway, no zoom transition, no methods layer (Phases 2–4).

## Out of scope (deferred)

| Phase | Status |
|---|---|
| 2 — Zoom into shared cutaway | Started — see `lung-health-visual-phase2.md` |
| 3 — Per-pathway cellular highlights | Deferred; build one pathway template first when reached |
| 4 — Methods annotation layer | Deferred; use `methodsForLaterPhases` from the data file |
| 5 — Polish / a11y / mobile / publication links | Deferred |

## Checkpoint

After Phase 1 ships: stop, summarize interaction + copy layout, and wait for feedback before Phase 2.
