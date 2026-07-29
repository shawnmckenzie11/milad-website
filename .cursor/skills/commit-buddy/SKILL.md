---
name: commit-buddy
description: Autonomously commit and push finished stages in milad-website with why-focused messages, one workstream per commit. Use when a fix pass, feature chunk, RL feedback application, analysis isolation change, or successful lung:generate / lung:validate-layers run finishes, before a risky refactor, when uncommitted files pile up, or when asked to checkpoint, save, or push progress.
---

# Commit buddy

Keeps process history recoverable from `git log` without the maintainer asking for commits.
Engine: `scripts/commit-buddy.mjs`. Config: `.cursor/commit-buddy.json`.

## Commands

```bash
npm run buddy:check                      # read-only: dirty workstreams, gate decision
npm run buddy:note -- --workstream <id> "what just finished"
npm run buddy:commit -- --workstream <id> --subject "…" --body "…"
npm run buddy:sync                       # push commits that were never pushed
npm run buddy:off                        # pause autonomous checkpoints
npm run buddy:on                         # resume
```

Runtime state (log, stage notes, edit journal, lock) lives in the gitignored
`.cursor/commit-buddy/` directory.

## Message style

Match the repo's existing history: a capitalised imperative subject ending in a period,
then a body that explains **why**, not a diff summary. No conventional-commit prefixes.

**Good:**

```
Isolate legend lab analyses behind reclaimable leases.

Test 1 lost an analysis to a lease that never expired, so a stuck holder can no longer
strand work and the matcher surfaces stderr instead of failing with a bare exit code.
```

**Bad:** `fix: update analyses.mjs and jobs.mjs` (prefix, no why, names files the diff
already shows).

Autonomous fallback commits are subjected `Checkpoint <workstream> (N files).` so a reader
can tell machine checkpoints from deliberate stage commits. Both carry trailers:

```
Commit-Buddy: stage            # or: auto
Commit-Buddy-Workstream: image-layer-analysis
```

Future agents can reconstruct process with `git log --grep='Commit-Buddy-Workstream: image-layer-analysis'`.

## Workstream boundaries

Do not mix the two spun-off workstreams in one commit. First matching glob wins, so order in
the config matters.

| Workstream | Includes | Notes |
|------------|----------|-------|
| `image-layer-analysis` | `tools/lung-legend-lab/**`, `scripts/lung_*.py`, `scripts/generate-lung-cutaway.mjs`, `public/figures/lung-health/**`, `src/data/lungHealthLayers*.ts`, `src/data/lungHealthFeatureDatabase.ts`, lung rules/skills/agents | Analysis **outputs and data** |
| `projects-transition` | `src/pages/projects.astro`, `src/components/Project*`, `src/components/LungHealth*`, `src/lib/projectPresentation.ts`, `src/lib/lungHealthCamera.ts`, `src/data/lungHealthVisual.ts`, `src/data/lungHealthCutawayGeometry.ts`, `src/data/airwayScene.ts` | **Rendering and transition** of that data |
| `agent-tooling` | `.cursor/**` (non-lung), `scripts/commit-buddy.mjs`, `AGENTS.md`, `CLAUDE.md` | |
| `site` | remaining `src/**`, `content/**`, `public/**` | |
| `repo` | root config | Folded into the feature workstream when only one is dirty |

Ambiguity to remember: layer/feature **data** files are `image-layer-analysis`; camera,
geometry, and visual files that **draw** them are `projects-transition`.

When one file genuinely contains edits from two workstreams (typically root
`package.json`), do not split it by hand. Commit it with whichever workstream owns most of
the change and say so in the summary.

## Gitignored analysis workspaces

`tools/lung-legend-lab/workspace/*` is gitignored, so per-analysis folders such as
`analysis-28993c9f` are **not** recoverable from git — that is how Test 1 was lost.

The buddy therefore commits everything that makes an analysis *rebuildable*:

- recovery / regeneration scripts (`tools/lung-legend-lab/scripts/**`)
- test fixtures (`tools/lung-legend-lab/fixtures/**`)
- pipeline artifacts and layer outputs under `public/figures/lung-health/**`
- feature databases and generated layer data under `src/data/`

If an analysis is important enough to survive, export it into a tracked location
(fixtures, `public/figures/lung-health/debug/`, or a committed JSON snapshot) rather than
loosening `.gitignore`. Do not silently un-ignore the workspace directory: it holds bulky
uploads and scratch output, and committing it wholesale would bloat the repo.

## When it commits vs waits

Hooks call `commit-buddy.mjs auto` at the end of every agent turn and after every subagent
finishes. It commits only when at least one gate fires:

- a stage note is pending (an agent explicitly marked a finished stage)
- 5+ safe files are dirty
- 25+ minutes since the last commit
- a milestone path changed and 2+ files are dirty

A 6-minute cooldown suppresses back-to-back checkpoints unless a stage note is pending or
the change burst is large. It waits (never commits) during merge, rebase, cherry-pick,
revert, bisect, or detached HEAD.

## Safety

Never force-pushes, changes git config, passes `--no-verify`, amends, or rebases. Paths
matching the denylist (`.env*`, keys, credentials, `*.sqlite`) are withheld, staged content
is scanned for token-shaped strings, files over 40 MB are skipped, and withheld paths are
listed in the commit body so the omission is visible.

If a push is rejected (for example the branch is behind), the commit stays safely local and
the buddy reports it rather than force-pushing or auto-rebasing. Resolve by hand:

```bash
git pull --rebase   # then: npm run buddy:sync
```
