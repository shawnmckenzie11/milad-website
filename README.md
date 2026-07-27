# Dr. Nadia Milad — Lab Site

Static academic site for **Dr. Nadia Milad** (University of Ottawa), built with [Astro](https://astro.build) and TypeScript.

- **Contact (placeholder):** [miladn1@mcmaster.ca](mailto:miladn1@mcmaster.ca)
- **ResearchGate:** [https://www.researchgate.net/profile/Nadia-Milad](https://www.researchgate.net/profile/Nadia-Milad)
- **ORCID:** [https://orcid.org/0000-0002-1497-8224](https://orcid.org/0000-0002-1497-8224)
- **Cannabis Research Intelligence Tool:** [https://cannabis-paper-scraper.fly.dev](https://cannabis-paper-scraper.fly.dev)

## Routes

| Path | Purpose |
|------|---------|
| `/` | Home — name, affiliation, research focus, CTAs |
| `/publications` | Full publication list (synced from ResearchGate via ORCID) |
| `/projects` | Current projects derived from the last 5 years of publications |
| `/join` | Prospective students / researchers |
| `/cv` | Redirects to `/publications` |

The nav and footer link out to the cannabis paper scraper for fellow researchers.

## Research sync

Publications are **not** hand-edited Markdown. Run:

```bash
npm run sync:research
```

This script:

1. Fetches works from OpenAlex for ORCID `0000-0002-1497-8224` (same researcher as the ResearchGate profile — ResearchGate blocks scrapers).
2. Merges a collaborator-filtered PubMed harvest so recent papers ORCID has not yet mirrored still appear.
3. Enriches DOIs via Crossref; drops figshare supplements and superseded preprints.
4. Writes [`src/data/publications.json`](src/data/publications.json).
5. Clusters the last five years of titles into themed current projects in [`src/data/projects.json`](src/data/projects.json).

Commit the updated JSON after syncing so deploys stay offline-friendly.

## Content workflow

### Edit the Join page

Update copy in `content/pages/join.md`. Frontmatter `title` / `description` feed the page chrome; the body is rendered on `/join`.

### Adjust project themes

Keyword → theme mapping lives in [`scripts/sync-research.mjs`](scripts/sync-research.mjs) (`PROJECT_THEMES`). Re-run `npm run sync:research` after edits.

## Develop locally

Requires Node.js **≥ 22.12**.

```bash
npm install
npm run sync:research   # optional if JSON already present
npm run dev
```

Open the URL Astro prints (usually `http://localhost:4321`).

## Build & preview

```bash
npm run build
npm run preview
```

`npm run build` writes a static site to `dist/`, suitable for Cloudflare Pages or any static host.

## Project layout

```
content/pages/          # Join page Markdown
scripts/sync-research.mjs
src/data/               # Generated publications.json + projects.json
src/lib/research.ts     # Typed accessors for generated data
src/pages/              # Astro routes
```
