## Public-facing copy

Keep all visitor-facing UI professionally forward-facing.

- Do **not** expose implementation details, sync mechanics, data-pipeline notes, ORCID IDs, scrape limitations, `npm` commands, “last synced” timestamps, or “auto-derived / generated from” language on pages.
- Internal docs (`README.md`, scripts, code comments) may describe the ResearchGate → ORCID sync; the live site should read as a finished academic lab site.
- Prefer short scholarly framing (e.g. “Peer-reviewed research…”) over meta explanations of how content was populated.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Git checkpoints

Commit and push finished stages without being asked — git history is how the next session
recovers process. On branch **`image-processing-lab`**, write Tier 1 / Tier 2–specific
messages (codes + why). Check what is dirty with `npm run buddy:check`, then:

```
npm run buddy:commit -- --workstream image-layer-analysis --subject "…" --body "…"
```

Keep one workstream per commit (`image-layer-analysis` vs `projects-transition`). Cursor
hooks make a fallback Image Processing Lab checkpoint at the end of each turn if you
forget. See `.cursor/rules/commit-buddy.mdc`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
