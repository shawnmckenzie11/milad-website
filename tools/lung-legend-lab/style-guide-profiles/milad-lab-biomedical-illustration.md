# Biomedical Illustration Style Guide (Milad Lab)

Version **1.0.0** · Profile id: `milad-lab-biomedical-illustration`

## Purpose

Reusable scientific illustrations for the Milad Lab website. Every revision, extension, or variant should preserve a consistent visual language so figures feel like parts of the same scientific atlas.

## Core design principles

- Prefer a museum exhibit / journal figure aesthetic.
- Prioritize scientific clarity over artistic flourish.
- Build reusable base figures with highlightable layers.
- Keep illustrations biologically conservative and evidence-oriented.
- New versions should extend the visual system, not reinvent it.

## Visual style

- Flat colours with restrained palette.
- Clean, uniform line weights.
- Minimal shading.
- No photorealism.
- No painterly, anime, Ghibli, comic, cartoon, or infographic mascot styles.
- White / light grey backgrounds (`#ffffff` / `#f4f6f7`).
- Slate blue-grey outlines (`#3d5160`, `#4a6274`, `#8a97a1`).
- Simple geometric sans typography.
- Landscape compositions unless otherwise specified.

## Illustration framework

Every figure should separate:

1. Base anatomy
2. Cellular components
3. Immune components
4. Signalling elements
5. Disease / process overlays
6. Labels
7. Highlight regions

Avoid baking pathway-specific emphasis into the base illustration.

## Layer philosophy & naming (site-canonical)

Each biological structure should exist as an independent layer with a **stable kebab-case slug**. Legend codes (`A1`–`A4`, `B1`–`B9`) are UI / extract keys; filesystem and React data use slugs.

| Code | Stable slug | Group | Framework alias (docs only) |
|------|-------------|-------|-----------------------------|
| A1 | `trachea-conducting-airway` | base | anatomy_trachea |
| A2 | `bronchial-branches` | base | anatomy_bronchi |
| A3 | `alveolar-fields` | base | anatomy_alveoli |
| A4 | `airway-lumen` | base | anatomy_lumen |
| B1 | `airway-epithelium` | highlight | airway_epithelium |
| B2 | `airway-immune-compartment` | highlight | immune_airway |
| B3 | `neutrophils` | highlight | neutrophils |
| B4 | `alveolar-macrophages` | highlight | alveolar_macrophages |
| B5 | `dendritic-cells` | highlight | dendritic_cells |
| B6 | `antiviral-immune-mediators` | highlight | antiviral_mediators |
| B7 | `inflammatory-signaling` | highlight | inflammatory_signaling |
| B8 | `copd-inflammatory-structures` | highlight | copd_structures |
| B9 | `infection-antiviral-pathway` | highlight | infection_pathway |

Assets: `public/figures/lung-health/layers/{slug}.png` and `{slug}-outline.png`.

**Do not** invent snake_case layer IDs in new artwork manifests — map any external aliases to the kebab slugs above.

### iconInterpretation (legend crop policy)

| Value | Meaning |
|-------|---------|
| `1-discrete` | One glyph → one `{slug}.png` template. |
| `2-discrete` | Two different glyphs in one row → part crops `{slug}--{part}.png`, searched independently. |
| `multiple-adjacent-as-one` | Contiguous repeats or a wall/lining band as **one** structure (A1 trachea, B1 epithelium). Single union crop only — do **not** split into part templates. Expect weaker NCC than Tier-1 cell replicas; recover with band ROI, scale anchors, and freehand priors; prefer pending over forced FPs. |

B1 pathways for this atlas: `cannabis` + `base`.

## Scientific ontology (canonical labels)

Use the labels above for tissues, cells, mediators, and disease overlays when classifying legend rows or naming freehand regions. Prefer these names over synonyms in lab UI and generated data so the atlas stays searchable.

## Reusability

Every illustration should support future SVG highlighting, CSS / Framer Motion animation, React overlays, and interactive web masks — without rebuilding the base plate.

## Content rules

- Do not introduce unnecessary decorative elements.
- Avoid exaggerated pathology unless specifically requested.
- Do not include exposure-specific props in reusable base figures.

## Site compatibility (versioning)

Interactive lung-health figures on the site depend on:

1. **Stable layer slugs** — renaming breaks `lungHealthLayers.generated.ts` and outline URLs.
2. **Outline pair files** — `{slug}-outline.png` beside each searchable layer.
3. **Cutaway canvas size** — current neutral cutaway is **1024×953**; changing it requires regenerating ROIs, templates, and site assets together.
4. **Legend codes** — new figures may add codes, but published A/B mappings for this cutaway stay fixed unless intentionally migrated.

Treat new figures as **extensions** of this profile (new slugs + codes) rather than forks that reuse the same IDs for different biology.

## Modification rules for AI agents

When editing:

- Preserve composition unless instructed otherwise.
- Preserve visual language.
- Add new biology without changing unrelated structures.
- Never replace existing scientific conventions with stylistic embellishments.
- Maintain compatibility with previous layer names whenever possible.
- Think of the collection as one coherent atlas.
- For cutaway layer detection, follow `.cursor/skills/lung-legend-template-match/SKILL.md` (OpenCV template match only).
- `multiple-adjacent-as-one` (A1/B1): one union template; widen ROI to the anatomical band; soft freehand priors; do not invent part-crop detectors.

Project rule: `.cursor/rules/lung-biomedical-illustration.mdc`.

## Preferred deliverables

1. Layered SVG (preferred for future work)
2. Figma
3. PSD
4. High-resolution PNG
5. Region masks if layered output is unavailable

## Image-generation prompt templates

**Deferred.** The current pipeline authors PNGs externally and matches legend glyphs with OpenCV. Prompt packs belong here only if the lab adopts generative figure drafting; until then, use this Markdown + the JSON profile as the single source of visual / ontology truth.

## Long-term goal

A modular library of consistent biomedical figures that can be recombined, highlighted, animated, and extended across the Milad Lab website while maintaining a single, recognizable scientific identity.
