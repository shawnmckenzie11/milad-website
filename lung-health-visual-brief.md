# Project brief: interactive lung health research visualization

## What this is

An interactive scientific illustration for the Milad Lab website (milad.mckenzian.com). A person stands outdoors in Ottawa. Five clickable exposure pathways — cannabis, cigarette smoke, general air (COPD-relevant particulates), vaping, viruses — each transition the scene into a shared schematic lung/airway cutaway, highlighting the specific cells and structures that pathway's research addresses.

**Phase 0 lock:** bacteria was swapped for vaping. Canonical pathway captions live in `src/data/lungHealthVisual.ts`.

**This is a multi-session build. Do not attempt the full interaction, all five pathway states, and final polish in one pass.** Work phase by phase (below), and stop for my review at each checkpoint before continuing. If you think you're about to implement something not explicitly approved in this brief or in my last message, stop and ask instead of guessing.

## Locked creative direction — do not deviate without asking

- **Style: scientific/schematic cutaway**, not a whiteboard-explainer or painterly illustration. Think museum-exhibit poster / figure-panel aesthetic — the same visual grammar as the multi-panel figures already published on the site (flat color fills, clean line work, labeled structures, no photorealism, no gradients-as-decoration).
- **One shared lung/airway diagram, not five separate illustrations.** All five pathways zoom into the *same* cutaway. Each pathway swaps a highlight layer (which cells/structures light up, what color, what annotation) rather than swapping the whole image. This keeps the asset count small and makes it maintainable as new papers come out.
- **The cutaway is also the convergence point.** After a pathway shows its cellular effect, a secondary interaction ("how we study this") swaps the same view into a methods-annotation layer (murine models, aerosol exposure, tissue transcriptomics, etc. — pulled from the site's own "Approaches in the lab" list). Do not build a separate illustrated "lab hub" scene — route everything through the one cutaway.

## Phased roadmap

| Phase | Deliverable | Stop and check in on |
|---|---|---|
| 0 | Content lock: final list of 5 pathways confirmed, one caption per pathway sourced from real project evidence | **Done** — locked in `src/data/lungHealthVisual.ts` (vaping replaces bacteria). Phase 1 plan: `lung-health-visual-phase1.md` |
| 1 | Static outdoor scene + 5 hotspots, placeholder shapes, no anatomy zoom | Interaction pattern and copy layout |
| 2 | Zoom/transition from outdoor scene into the shared cutaway | Transition feel (speed, easing, camera behavior) |
| 3 | Per-pathway cellular highlight states on the shared cutaway | One pathway state fully built first — approve it as the template before I build the other four |
| 4 | Secondary "how we study this" methods-annotation layer | Content accuracy against the site's approaches list |
| 5 | Polish: motion timing, accessibility (keyboard nav, alt text, reduced-motion), responsive/mobile layout, publication links | Final review before considered done |

Do not start a phase until I've explicitly approved the previous one.

## Content rules

- All pathway captions and highlighted structures must trace back to real content on milad.mckenzian.com/projects (or content I give you directly). Do not invent findings, cell types, or mechanisms to fill a gap.
- If a pathway's research backing is thin, flag it rather than filling it in with plausible-sounding biology. (Bacteria was removed in Phase 0; general air remains the softest fit.)
- Keep caption copy plain and direct — no corporate/marketing tone, no padding.

## Image/asset generation — optimize for consistency, not speed

The biggest failure mode for this project is style drift between the five pathway states. Before generating any final art:

1. Propose an asset strategy to me first (e.g., hand-built SVG vs. AI-generated base illustration sliced into layers vs. a hybrid — SVG cutaway with AI-generated texture/detail elements) and wait for approval.
2. If using AI image generation for any component: lock a single reference sheet first (line weight, palette, level of stylization) and generate **one sample pathway state** for my approval before producing the rest. Every subsequent asset should be generated against that same reference/seed, not independently.
3. Prefer SVG for anything that needs to change color/visibility per pathway (the highlight layers) — raster images can't be recolored or partially revealed cleanly. Reserve raster/AI-generated assets for static background elements only if at all.
4. Do not batch-generate all five pathway states before I've approved the template state from Phase 3.

## Tech stack

- Site is Astro. Keep it Astro — don't propose a framework migration.
- Build the interactive piece as a single React island (`client:load`) rather than vanilla JS, since Phases 3-4 involve real state (active pathway, active layer, transition sequencing).
- Framer Motion for transitions.
- Content (captions, highlight-layer definitions, method annotations) should live in a structured data file (JSON/TS), not hardcoded in JSX, so future pathway or content updates don't require touching component logic.

## Working style

- Before writing code for a new phase, restate your plan for that phase in a couple of sentences and wait for my go-ahead.
- After finishing a phase, stop, summarize what changed, and ask for feedback before moving to the next phase.
- If something in this brief conflicts with what's fastest to build, tell me — don't silently take the easier path.
