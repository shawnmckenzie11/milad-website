#!/usr/bin/env node
/**
 * Commit buddy — autonomous, workstream-aware git checkpointing.
 *
 * Purpose: keep process history recoverable from `git log` without the maintainer
 * having to ask for a commit. Cursor hooks call the `auto` subcommand at agent
 * turn boundaries; agents call `commit` / `note` directly when they know a stage
 * just finished.
 *
 * Subcommands:
 *   check                       Report what would happen (read-only).
 *   auto   [--trigger <name>]   Commit + push each dirty workstream if gates pass.
 *   commit --subject "..."      Commit one workstream with an agent-authored message.
 *   note   "<text>"             Record a stage note consumed by the next commit body.
 *   sync                        Push unpushed commits on the current branch.
 *   on | off                    Toggle the buddy (writes/removes a local kill switch).
 *
 * Safety invariants: never force-pushes, never touches git config, never skips
 * hooks, never amends, never rebases, never commits denylisted or secret-bearing
 * files, never creates empty commits.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const STATE_DIR_NAME = path.join('.cursor', 'commit-buddy');
const CONFIG_FILE_NAME = path.join('.cursor', 'commit-buddy.json');
const CO_AUTHOR_TRAILER = 'Co-authored-by: Cursor <cursoragent@cursor.com>';
const MAX_LOG_BYTES = 512 * 1024;
const LOCK_STALE_MS = 120_000;

/**
 * Default configuration. `.cursor/commit-buddy.json` is shallow-merged on top,
 * so the checked-in config only needs to state what it overrides.
 *
 * @returns {object} Default config object.
 */
function defaultConfig() {
  return {
    enabled: true,
    push: true,
    gates: {
      minChangedFiles: 5,
      minMinutesSinceLastCommit: 25,
      cooldownMinutes: 6,
      milestoneMinFiles: 2,
      burstMultiplier: 3,
      milestoneGlobs: [],
    },
    maxFileSizeMb: 40,
    maxGroupsPerRun: 6,
    sharedWorkstreamId: 'repo',
    workstreams: [],
    branchProjects: {},
    neverCommitGlobs: [],
    secretPatterns: [],
  };
}

/**
 * Resolve the active branch's project overlay from config (if any).
 *
 * On `image-processing-lab`, this steers commit subjects and trailers toward
 * Tier 1 / Tier 2 lab work instead of a generic workstream label.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {{branch: string, project: object|null}} Branch name and overlay.
 */
function resolveBranchProject(root, config) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  const project = config.branchProjects?.[branch] ?? null;
  return { branch, project };
}

/**
 * Run a command synchronously and capture its output.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Argument list.
 * @param {{cwd?: string, input?: string|Buffer}} [options] Spawn options.
 * @returns {{code: number, out: string, err: string}} Exit code and trimmed streams.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status === null ? 1 : result.status,
    out: (result.stdout ?? '').toString(),
    err: (result.stderr ?? '').toString().trim(),
  };
}

/**
 * Run a git command inside the repository root.
 *
 * @param {string} root Repository root directory.
 * @param {string[]} args Git arguments.
 * @param {{input?: string|Buffer}} [options] Optional stdin payload.
 * @returns {{code: number, out: string, err: string}} Git result.
 */
function git(root, args, options = {}) {
  return run('git', args, { cwd: root, input: options.input });
}

/**
 * Locate the repository root from the current working directory.
 *
 * @returns {string|null} Absolute repo root, or null when not inside a repo.
 */
function findRepoRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) return null;
  const root = result.out.trim();
  return root.length > 0 ? root : null;
}

/**
 * Load configuration, merging the repo config file over the defaults.
 *
 * @param {string} root Repository root directory.
 * @returns {object} Effective configuration.
 */
function loadConfig(root) {
  const base = defaultConfig();
  const file = path.join(root, CONFIG_FILE_NAME);
  if (!existsSync(file)) return base;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { ...base, ...parsed, gates: { ...base.gates, ...(parsed.gates ?? {}) } };
  } catch (error) {
    process.stderr.write(`commit-buddy: ignoring malformed ${CONFIG_FILE_NAME} (${error.message})\n`);
    return base;
  }
}

/**
 * Resolve the runtime state directory, creating it when missing.
 *
 * @param {string} root Repository root directory.
 * @returns {string} Absolute path to the state directory.
 */
function stateDir(root) {
  const dir = path.join(root, STATE_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Append a timestamped line to the buddy log, truncating it when oversized.
 *
 * @param {string} root Repository root directory.
 * @param {string} message Line to record.
 * @returns {void}
 */
function log(root, message) {
  const file = path.join(stateDir(root), 'buddy.log');
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      writeFileSync(file, `${new Date().toISOString()} log truncated\n`);
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break a hook.
  }
}

/**
 * Read persisted buddy state.
 *
 * @param {string} root Repository root directory.
 * @returns {object} State object (empty when absent or unreadable).
 */
function loadState(root) {
  const file = path.join(stateDir(root), 'state.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persist buddy state.
 *
 * @param {string} root Repository root directory.
 * @param {object} state State object to write.
 * @returns {void}
 */
function saveState(root, state) {
  try {
    writeFileSync(path.join(stateDir(root), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Non-fatal.
  }
}

/**
 * Acquire a coarse lock so overlapping hook invocations cannot interleave commits.
 *
 * @param {string} root Repository root directory.
 * @returns {(() => void)|null} Release function, or null when another run holds the lock.
 */
function acquireLock(root) {
  const file = path.join(stateDir(root), 'run.lock');
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < LOCK_STALE_MS) return null;
    writeFileSync(file, `${process.pid}\n`);
    return () => {
      try {
        rmSync(file, { force: true });
      } catch {
        // Non-fatal.
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Convert a glob (`*`, `?`, `**`) into an anchored regular expression.
 *
 * @param {string} glob Glob pattern using forward slashes.
 * @returns {RegExp} Anchored matcher for repo-relative paths.
 */
function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

const globCache = new Map();

/**
 * Test a repo-relative path against a list of globs.
 *
 * @param {string} filePath Repo-relative path.
 * @param {string[]} globs Glob patterns.
 * @returns {boolean} True when any glob matches.
 */
function matchesAny(filePath, globs) {
  for (const glob of globs ?? []) {
    let matcher = globCache.get(glob);
    if (!matcher) {
      matcher = globToRegExp(glob);
      globCache.set(glob, matcher);
    }
    if (matcher.test(filePath)) return true;
  }
  return false;
}

/**
 * Parse `git status --porcelain=v1 -z` output into path records.
 *
 * @param {string} raw NUL-separated porcelain payload.
 * @returns {Array<{code: string, filePath: string}>} Status records.
 */
function parseStatus(raw) {
  const records = raw.split('\0').filter((entry) => entry.length > 0);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    const filePath = record.slice(3);
    entries.push({ code, filePath });
    // Rename/copy records are followed by their source path in a separate field.
    if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
      const source = records[index + 1];
      index += 1;
      if (source) entries.push({ code, filePath: source });
    }
  }
  return entries;
}

/**
 * Detect repository states where automatic commits are unsafe.
 *
 * @param {string} root Repository root directory.
 * @returns {string|null} Human-readable blocker, or null when safe to proceed.
 */
function findRepoBlocker(root) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  if (gitDir.code !== 0) return 'not a git repository';
  const dir = gitDir.out.trim();
  if (existsSync(path.join(dir, 'MERGE_HEAD'))) return 'merge in progress';
  if (existsSync(path.join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick in progress';
  if (existsSync(path.join(dir, 'REVERT_HEAD'))) return 'revert in progress';
  if (existsSync(path.join(dir, 'BISECT_LOG'))) return 'bisect in progress';
  if (existsSync(path.join(dir, 'rebase-merge')) || existsSync(path.join(dir, 'rebase-apply'))) {
    return 'rebase in progress';
  }
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  if (!branch || branch === 'HEAD') return 'detached HEAD';
  return null;
}

/**
 * Report whether the buddy is currently switched off.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {string|null} Reason the buddy is disabled, or null when enabled.
 */
function findDisabledReason(root, config) {
  if (process.env.COMMIT_BUDDY === 'off') return 'COMMIT_BUDDY=off';
  if (config.enabled === false) return `disabled in ${CONFIG_FILE_NAME}`;
  if (existsSync(path.join(root, STATE_DIR_NAME, 'disabled'))) return 'kill switch file present';
  return null;
}

/**
 * Assign a repo-relative path to its workstream.
 *
 * @param {string} filePath Repo-relative path.
 * @param {object} config Effective configuration.
 * @returns {string} Workstream id (falls back to the shared id).
 */
function assignWorkstream(filePath, config) {
  for (const workstream of config.workstreams ?? []) {
    if (matchesAny(filePath, workstream.globs)) return workstream.id;
  }
  return config.sharedWorkstreamId;
}

/**
 * Look up a workstream's display label.
 *
 * @param {string} id Workstream id.
 * @param {object} config Effective configuration.
 * @returns {string} Human-readable label.
 */
function workstreamLabel(id, config) {
  const found = (config.workstreams ?? []).find((workstream) => workstream.id === id);
  return found?.label ?? id;
}

/**
 * Collect commit candidates from the working tree, dropping unsafe paths.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {{files: Array<{filePath: string, workstream: string}>, skipped: Array<{filePath: string, reason: string}>}}
 *   Safe candidates plus the paths that were withheld and why.
 */
function collectCandidates(root, config) {
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const files = [];
  const skipped = [];
  const seen = new Set();
  const maxBytes = (config.maxFileSizeMb ?? 40) * 1024 * 1024;

  for (const entry of parseStatus(status.out)) {
    const { filePath } = entry;
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    if (filePath.startsWith(`${STATE_DIR_NAME}/`)) continue;
    if (matchesAny(filePath, config.neverCommitGlobs)) {
      skipped.push({ filePath, reason: 'denylisted path (possible secret)' });
      continue;
    }
    const absolute = path.join(root, filePath);
    if (existsSync(absolute)) {
      let size = 0;
      try {
        size = statSync(absolute).size;
      } catch {
        size = 0;
      }
      if (size > maxBytes) {
        skipped.push({ filePath, reason: `larger than ${config.maxFileSizeMb} MB` });
        continue;
      }
    }
    files.push({ filePath, workstream: assignWorkstream(filePath, config) });
  }
  return { files, skipped };
}

/**
 * Group candidates into ordered workstream buckets.
 *
 * Shared/root files are folded into the single feature workstream when exactly one
 * is dirty, so dependency or config changes travel with the work that needed them.
 *
 * @param {Array<{filePath: string, workstream: string}>} files Safe candidates.
 * @param {object} config Effective configuration.
 * @returns {Array<{id: string, label: string, paths: string[]}>} Ordered groups.
 */
function groupByWorkstream(files, config) {
  const buckets = new Map();
  for (const file of files) {
    if (!buckets.has(file.workstream)) buckets.set(file.workstream, []);
    buckets.get(file.workstream).push(file.filePath);
  }

  const sharedId = config.sharedWorkstreamId;
  const featureIds = [...buckets.keys()].filter((id) => id !== sharedId);
  if (featureIds.length === 1 && buckets.has(sharedId)) {
    buckets.get(featureIds[0]).push(...buckets.get(sharedId));
    buckets.delete(sharedId);
  }

  const order = (config.workstreams ?? []).map((workstream) => workstream.id);
  return [...buckets.entries()]
    .sort((left, right) => {
      const leftIndex = order.indexOf(left[0]);
      const rightIndex = order.indexOf(right[0]);
      return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
    })
    .map(([id, paths]) => ({ id, label: workstreamLabel(id, config), paths: paths.sort() }));
}

/**
 * Minutes elapsed since an ISO timestamp.
 *
 * @param {string|undefined} iso ISO timestamp.
 * @returns {number} Elapsed minutes (Infinity when the timestamp is missing/invalid).
 */
function minutesSince(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 60_000;
}

/**
 * Minutes since the tip commit was authored.
 *
 * @param {string} root Repository root directory.
 * @returns {number} Elapsed minutes (Infinity for an empty repo).
 */
function minutesSinceHeadCommit(root) {
  const result = git(root, ['log', '-1', '--format=%cI']);
  if (result.code !== 0) return Number.POSITIVE_INFINITY;
  return minutesSince(result.out.trim());
}

/**
 * Read pending stage notes.
 *
 * @param {string} root Repository root directory.
 * @returns {Array<{ts: string, workstream: string, text: string}>} Recorded notes.
 */
function readNotes(root) {
  const file = path.join(stateDir(root), 'stage-notes.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((note) => note !== null);
}

/**
 * Overwrite the stage-note file with the notes that are still pending.
 *
 * @param {string} root Repository root directory.
 * @param {Array<object>} notes Notes to keep.
 * @returns {boolean} True when the notes were persisted.
 */
function writeNotes(root, notes) {
  try {
    const file = path.join(stateDir(root), 'stage-notes.jsonl');
    const body = notes.map((note) => JSON.stringify(note)).join('\n');
    writeFileSync(file, body.length > 0 ? `${body}\n` : '');
    return true;
  } catch (error) {
    log(root, `could not persist stage notes: ${error.message}`);
    return false;
  }
}

/**
 * Select the pending notes that belong to a workstream.
 *
 * @param {Array<object>} notes Pending notes.
 * @param {string} workstreamId Target workstream id.
 * @returns {Array<object>} Notes for this workstream plus unscoped notes.
 */
function notesForWorkstream(notes, workstreamId) {
  return notes.filter((note) => !note.workstream || note.workstream === 'all' || note.workstream === workstreamId);
}

/**
 * Read the ordered edit sequence recorded by the journal hook.
 *
 * @param {string} root Repository root directory.
 * @param {string[]} paths Paths to restrict the sequence to.
 * @param {number} [limit] Maximum entries to return.
 * @returns {string[]} Distinct paths in the order they were last edited.
 */
function readEditSequence(root, paths, limit = 10) {
  const file = path.join(stateDir(root), 'journal.log');
  if (!existsSync(file)) return [];
  const allowed = new Set(paths);
  const ordered = [];
  let lines = [];
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
  for (const line of lines) {
    const [, edited] = line.split('\t');
    if (!edited) continue;
    const relative = path.isAbsolute(edited) ? path.relative(root, edited) : edited;
    if (!allowed.has(relative)) continue;
    const existing = ordered.indexOf(relative);
    if (existing !== -1) ordered.splice(existing, 1);
    ordered.push(relative);
  }
  return ordered.slice(-limit);
}

/**
 * Clear the edit journal so the next checkpoint describes only the next stage.
 *
 * @param {string} root Repository root directory.
 * @returns {void}
 */
function resetJournal(root) {
  try {
    writeFileSync(path.join(stateDir(root), 'journal.log'), '');
  } catch {
    // Non-fatal.
  }
}

/**
 * Scan candidate paths for secret-looking content that must not be committed.
 *
 * Tracked files are scanned across their diff against HEAD; untracked files are
 * scanned in full. Binary files are skipped.
 *
 * @param {string} root Repository root directory.
 * @param {string[]} paths Repo-relative candidate paths.
 * @param {object} config Effective configuration.
 * @returns {{clean: string[], flagged: Array<{filePath: string, patternId: string}>}} Scan outcome.
 */
function scanForSecrets(root, paths, config) {
  const matchers = (config.secretPatterns ?? [])
    .map((entry) => {
      try {
        return { id: entry.id ?? entry.pattern, regex: new RegExp(entry.pattern, entry.flags ?? '') };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);

  if (matchers.length === 0) return { clean: [...paths], flagged: [] };

  const clean = [];
  const flagged = [];
  for (const filePath of paths) {
    const absolute = path.join(root, filePath);
    let text = '';
    const tracked = git(root, ['ls-files', '--error-unmatch', '--', filePath]).code === 0;
    if (tracked) {
      const diff = git(root, ['diff', 'HEAD', '-U0', '--', filePath]);
      text = diff.out;
    } else if (existsSync(absolute)) {
      try {
        const buffer = readFileSync(absolute);
        if (buffer.subarray(0, 8000).includes(0)) {
          clean.push(filePath);
          continue;
        }
        text = buffer.toString('utf8');
      } catch {
        text = '';
      }
    }
    const hit = matchers.find((matcher) => matcher.regex.test(text));
    if (hit) flagged.push({ filePath, patternId: hit.id });
    else clean.push(filePath);
  }
  return { clean, flagged };
}

/**
 * Decide whether the current dirty tree justifies an automatic checkpoint.
 *
 * @param {object} params Evaluation inputs.
 * @param {object} params.config Effective configuration.
 * @param {string[]} params.paths Safe candidate paths.
 * @param {number} params.minutesSinceCommit Minutes since the tip commit.
 * @param {number} params.minutesSinceBuddyCommit Minutes since the last buddy checkpoint.
 * @param {boolean} params.hasNotes Whether stage notes are pending.
 * @returns {{shouldCommit: boolean, reasons: string[], waiting: string[]}} Gate decision.
 */
function evaluateGates({ config, paths, minutesSinceCommit, minutesSinceBuddyCommit, hasNotes }) {
  const gates = config.gates ?? {};
  const reasons = [];
  const waiting = [];

  if (paths.length === 0) {
    return { shouldCommit: false, reasons, waiting: ['no safe changes in the working tree'] };
  }
  if (hasNotes) reasons.push('an agent recorded a finished stage');
  if (paths.length >= (gates.minChangedFiles ?? 5)) reasons.push(`${paths.length} files changed`);
  if (minutesSinceCommit >= (gates.minMinutesSinceLastCommit ?? 25)) {
    reasons.push(`${Math.round(minutesSinceCommit)} min since the last commit`);
  }
  if (
    matchesAnyOfPaths(paths, gates.milestoneGlobs ?? []) &&
    paths.length >= (gates.milestoneMinFiles ?? 2)
  ) {
    reasons.push('a milestone path changed');
  }

  if (reasons.length === 0) {
    waiting.push(
      `only ${paths.length} file(s) changed ${Math.round(minutesSinceCommit)} min after the last commit`,
    );
    return { shouldCommit: false, reasons, waiting };
  }

  const burstFloor = (gates.minChangedFiles ?? 5) * (gates.burstMultiplier ?? 3);
  const coolingDown = minutesSinceBuddyCommit < (gates.cooldownMinutes ?? 6);
  if (coolingDown && !hasNotes && paths.length < burstFloor) {
    waiting.push(`cooling down (${Math.round(minutesSinceBuddyCommit)} min since the last checkpoint)`);
    return { shouldCommit: false, reasons, waiting };
  }
  return { shouldCommit: true, reasons, waiting };
}

/**
 * Test a set of paths against a glob list.
 *
 * @param {string[]} paths Repo-relative paths.
 * @param {string[]} globs Glob patterns.
 * @returns {boolean} True when any path matches any glob.
 */
function matchesAnyOfPaths(paths, globs) {
  return paths.some((filePath) => matchesAny(filePath, globs));
}

/**
 * Summarise a path list into a few directory hints.
 *
 * @param {string[]} paths Repo-relative paths.
 * @param {number} [limit] Maximum hints to return.
 * @returns {string[]} Directory hints, most-changed first.
 */
function directoryHints(paths, limit = 4) {
  const counts = new Map();
  for (const filePath of paths) {
    const segments = filePath.split('/');
    const key = segments.length === 1 ? '(repo root)' : segments.slice(0, Math.min(2, segments.length - 1)).join('/');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * Build an automatic checkpoint commit message.
 *
 * Subjects are marked `Checkpoint …` so a reader can tell machine checkpoints
 * from deliberate, agent-authored stage commits. On a branch with a
 * `branchProjects` overlay (e.g. `image-processing-lab`), the subject and body
 * name that project and its Tier 1/2 focus.
 *
 * @param {object} params Message inputs.
 * @param {{id: string, label: string, paths: string[]}} params.group Workstream group.
 * @param {string} params.trigger Trigger name (hook event or `manual`).
 * @param {string[]} params.reasons Gate reasons that fired.
 * @param {Array<object>} params.notes Stage notes to fold into the body.
 * @param {string[]} params.editSequence Ordered edit trail from the journal hook.
 * @param {Array<{filePath: string, reason: string}>} params.withheld Paths intentionally not committed.
 * @param {object|null} [params.branchProject] Active branch project overlay.
 * @param {string} [params.branch] Current branch name.
 * @returns {string} Full commit message.
 */
function buildAutoMessage({ group, trigger, reasons, notes, editSequence, withheld, branchProject, branch }) {
  const count = group.paths.length;
  const onLabProject =
    Boolean(branchProject) &&
    (!branchProject.primaryWorkstream || branchProject.primaryWorkstream === group.id);
  const subject = onLabProject
    ? `${branchProject.checkpointSubject ?? branchProject.project} (${count} file${count === 1 ? '' : 's'}).`
    : `Checkpoint ${group.label} (${count} file${count === 1 ? '' : 's'}).`;
  const lines = [
    subject,
    '',
    onLabProject
      ? `Autonomous Image Processing Lab checkpoint while tuning Tier 1 / Tier 2 matching.`
      : 'Autonomous checkpoint so this stage stays reconstructable from git history.',
    '',
  ];
  if (onLabProject) {
    lines.push(`Project: ${branchProject.project}.`, `Focus: ${branchProject.focus}.`, '');
    if (branchProject.messageGuidance) {
      lines.push(`Guidance: ${branchProject.messageGuidance}`, '');
    }
  }
  lines.push(
    `Trigger: ${trigger} — ${reasons.join('; ')}.`,
    `Workstream: ${group.id} (${group.label}).`,
    `Branch: ${branch ?? 'unknown'}.`,
    `Areas: ${directoryHints(group.paths).join(', ')}.`,
  );

  if (notes.length > 0) {
    lines.push('', 'Stages captured:');
    for (const note of notes) lines.push(`- ${note.text}`);
  } else if (editSequence.length > 0) {
    lines.push('', 'No stage note was recorded; edit order was:');
    for (const filePath of editSequence) lines.push(`- ${filePath}`);
  }
  lines.push('', 'Files:');
  for (const filePath of group.paths.slice(0, 15)) lines.push(`- ${filePath}`);
  if (count > 15) lines.push(`- …and ${count - 15} more`);

  if (withheld.length > 0) {
    lines.push('', 'Withheld from this commit:');
    for (const item of withheld) lines.push(`- ${item.filePath} (${item.reason})`);
  }

  lines.push('', `Commit-Buddy: auto`, `Commit-Buddy-Workstream: ${group.id}`);
  if (onLabProject) {
    lines.push(`Commit-Buddy-Project: ${branchProject.project}`);
    lines.push(`Commit-Buddy-Branch: ${branch}`);
  }
  lines.push(CO_AUTHOR_TRAILER);
  return `${lines.join('\n')}\n`;
}

/**
 * Build an agent-authored stage commit message.
 *
 * @param {object} params Message inputs.
 * @param {string} params.subject Imperative subject line.
 * @param {string} [params.body] Why-focused body.
 * @param {{id: string, label: string, paths: string[]}} params.group Workstream group.
 * @param {Array<object>} params.notes Stage notes to fold into the body.
 * @param {object|null} [params.branchProject] Active branch project overlay.
 * @param {string} [params.branch] Current branch name.
 * @returns {string} Full commit message.
 */
function buildStageMessage({ subject, body, group, notes, branchProject, branch }) {
  const normalized = /[.!?]$/.test(subject.trim()) ? subject.trim() : `${subject.trim()}.`;
  const onLabProject =
    Boolean(branchProject) &&
    (!branchProject.primaryWorkstream || branchProject.primaryWorkstream === group.id);
  const lines = [normalized, ''];
  if (onLabProject) {
    lines.push(
      `Image Processing Lab (${branch}) — ${branchProject.focus}.`,
      '',
    );
  }
  if (body) lines.push(body.trim(), '');
  if (notes.length > 0) {
    lines.push('Stages captured:');
    for (const note of notes) lines.push(`- ${note.text}`);
    lines.push('');
  }
  lines.push(`Commit-Buddy: stage`, `Commit-Buddy-Workstream: ${group.id}`);
  if (onLabProject) {
    lines.push(`Commit-Buddy-Project: ${branchProject.project}`);
    lines.push(`Commit-Buddy-Branch: ${branch}`);
  }
  lines.push(CO_AUTHOR_TRAILER);
  return `${lines.join('\n')}\n`;
}

/**
 * Report whether the index holds staged changes for any of the given paths.
 *
 * `git diff` takes pathspecs only as arguments, so the list is chunked to stay
 * well clear of the platform argument limit.
 *
 * @param {string} root Repository root directory.
 * @param {string[]} paths Repo-relative paths.
 * @returns {boolean} True when at least one path differs from HEAD in the index.
 */
function hasStagedChanges(root, paths) {
  const hasHead = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).code === 0;
  const base = hasHead ? ['diff', '--cached', '--quiet', 'HEAD', '--'] : ['diff', '--cached', '--quiet', '--'];
  const chunkSize = 200;
  for (let start = 0; start < paths.length; start += chunkSize) {
    const chunk = paths.slice(start, start + chunkSize);
    if (git(root, [...base, ...chunk]).code !== 0) return true;
  }
  return false;
}

/**
 * Stage and commit one workstream group using a pathspec commit.
 *
 * A pathspec commit leaves any unrelated pre-staged index entries untouched, so a
 * checkpoint for one workstream cannot absorb another workstream's staged work.
 *
 * @param {string} root Repository root directory.
 * @param {{id: string, paths: string[]}} group Workstream group to commit.
 * @param {string} message Commit message.
 * @returns {{ok: boolean, reason?: string, sha?: string}} Commit outcome.
 */
function commitGroup(root, group, message) {
  const pathspec = `${group.paths.join('\0')}\0`;
  const added = git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: pathspec });
  if (added.code !== 0) return { ok: false, reason: `git add failed: ${added.err}` };

  if (!hasStagedChanges(root, group.paths)) {
    return { ok: false, reason: 'nothing to commit for this workstream' };
  }

  const messageFile = path.join(stateDir(root), 'COMMIT_MSG');
  writeFileSync(messageFile, message);
  const committed = git(
    root,
    ['commit', '--file', messageFile, '--pathspec-from-file=-', '--pathspec-file-nul'],
    { input: pathspec },
  );
  if (committed.code !== 0) {
    return { ok: false, reason: `git commit failed: ${committed.err || committed.out.trim()}` };
  }
  return { ok: true, sha: git(root, ['rev-parse', '--short', 'HEAD']).out.trim() };
}

/**
 * Push the current branch, setting upstream on first push. Never forces.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {{ok: boolean, skipped?: string, reason?: string, detail?: string}} Push outcome.
 */
function pushCurrentBranch(root, config) {
  if (config.push === false) return { ok: false, skipped: 'push disabled in config' };
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  if (!branch || branch === 'HEAD') return { ok: false, skipped: 'detached HEAD' };

  const hasUpstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).code === 0;
  if (hasUpstream) {
    const ahead = git(root, ['rev-list', '--count', '@{u}..HEAD']).out.trim();
    if (ahead === '0') return { ok: true, skipped: 'already up to date with the remote' };
  }
  const args = hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch];
  const pushed = git(root, args);
  if (pushed.code !== 0) {
    return { ok: false, reason: 'push rejected or failed; commit is safe locally', detail: pushed.err };
  }
  return { ok: true };
}

/**
 * Build the read-only situation report shared by `check` and `auto`.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {object} Snapshot of gates, groups, and withheld paths.
 */
function buildReport(root, config) {
  const { files, skipped } = collectCandidates(root, config);
  const groups = groupByWorkstream(files, config);
  const notes = readNotes(root);
  const state = loadState(root);
  const decision = evaluateGates({
    config,
    paths: files.map((file) => file.filePath),
    minutesSinceCommit: minutesSinceHeadCommit(root),
    minutesSinceBuddyCommit: minutesSince(state.lastAutoCommitAt),
    hasNotes: notes.length > 0,
  });
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  const hasUpstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).code === 0;
  return {
    branch,
    hasUpstream,
    unpushed: hasUpstream ? Number(git(root, ['rev-list', '--count', '@{u}..HEAD']).out.trim() || '0') : null,
    changedFiles: files.length,
    groups: groups.map((group) => ({ id: group.id, label: group.label, files: group.paths.length, paths: group.paths })),
    pendingNotes: notes,
    withheld: skipped,
    decision,
  };
}

/**
 * `check` — print a read-only assessment of the working tree.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @param {object} args Parsed CLI arguments.
 * @returns {number} Process exit code.
 */
function cmdCheck(root, config, args) {
  const report = buildReport(root, config);
  const disabled = findDisabledReason(root, config);
  const blocker = findRepoBlocker(root);
  const { project: branchProject } = resolveBranchProject(root, config);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, disabled, blocker, branchProject }, null, 2)}\n`);
    return 0;
  }
  const lines = [
    `branch: ${report.branch}${report.hasUpstream ? '' : ' (no upstream yet)'}`,
    `unpushed commits: ${report.unpushed ?? 'unknown'}`,
    `changed files (safe): ${report.changedFiles}`,
  ];
  if (branchProject) {
    lines.push(`project overlay: ${branchProject.project} — ${branchProject.focus}`);
  }
  if (disabled) lines.push(`buddy disabled: ${disabled}`);
  if (blocker) lines.push(`blocked: ${blocker}`);
  for (const group of report.groups) lines.push(`  - ${group.id} (${group.label}): ${group.files} file(s)`);
  for (const note of report.pendingNotes) lines.push(`  note [${note.workstream ?? 'all'}]: ${note.text}`);
  for (const item of report.withheld) lines.push(`  withheld: ${item.filePath} — ${item.reason}`);
  lines.push(
    report.decision.shouldCommit
      ? `would commit now: ${report.decision.reasons.join('; ')}`
      : `would wait: ${(report.decision.waiting.length > 0 ? report.decision.waiting : ['no reason to commit']).join('; ')}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

/**
 * `auto` — checkpoint every dirty workstream separately when the gates pass.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @param {object} args Parsed CLI arguments.
 * @returns {number} Process exit code (always 0 so hooks never block the agent).
 */
function cmdAuto(root, config, args) {
  const trigger = args.trigger ?? 'manual';
  const disabled = findDisabledReason(root, config);
  if (disabled) {
    log(root, `auto(${trigger}) skipped: ${disabled}`);
    return 0;
  }
  const blocker = findRepoBlocker(root);
  if (blocker) {
    log(root, `auto(${trigger}) skipped: ${blocker}`);
    return 0;
  }
  const release = acquireLock(root);
  if (!release) {
    log(root, `auto(${trigger}) skipped: another run holds the lock`);
    return 0;
  }

  try {
    const report = buildReport(root, config);
    if (!report.decision.shouldCommit) {
      if ((report.unpushed ?? 0) > 0) {
        const pushed = pushCurrentBranch(root, config);
        log(root, `auto(${trigger}) pushed ${report.unpushed} pending commit(s): ${JSON.stringify(pushed)}`);
      }
      log(root, `auto(${trigger}) waiting: ${report.decision.waiting.join('; ')}`);
      return 0;
    }

    const notes = readNotes(root);
    const consumed = new Set();
    const committed = [];
    const { branch, project: branchProject } = resolveBranchProject(root, config);
    for (const group of report.groups.slice(0, config.maxGroupsPerRun ?? 6)) {
      const scan = scanForSecrets(root, group.paths, config);
      const withheld = [
        ...report.withheld,
        ...scan.flagged.map((item) => ({ filePath: item.filePath, reason: `matched secret pattern ${item.patternId}` })),
      ];
      if (scan.clean.length === 0) {
        log(root, `auto(${trigger}) skipped ${group.id}: every path was withheld`);
        continue;
      }
      const groupNotes = notesForWorkstream(notes, group.id);
      const message = buildAutoMessage({
        group: { ...group, paths: scan.clean },
        trigger,
        reasons: report.decision.reasons,
        notes: groupNotes,
        editSequence: readEditSequence(root, scan.clean),
        withheld,
        branchProject,
        branch,
      });
      const result = commitGroup(root, { ...group, paths: scan.clean }, message);
      if (result.ok) {
        committed.push({ id: group.id, sha: result.sha, files: scan.clean.length });
        for (const note of groupNotes) consumed.add(note);
        log(root, `auto(${trigger}) committed ${result.sha} for ${group.id} (${scan.clean.length} files)`);
      } else {
        log(root, `auto(${trigger}) could not commit ${group.id}: ${result.reason}`);
      }
    }

    if (committed.length === 0) return 0;
    writeNotes(root, notes.filter((note) => !consumed.has(note)));
    resetJournal(root);

    const pushed = pushCurrentBranch(root, config);
    log(root, `auto(${trigger}) push: ${JSON.stringify(pushed)}`);
    saveState(root, {
      ...loadState(root),
      lastAutoCommitAt: new Date().toISOString(),
      lastTrigger: trigger,
      lastCommits: committed,
      lastPush: pushed,
    });
    process.stdout.write(
      `commit-buddy: ${committed.map((entry) => `${entry.sha} ${entry.id}`).join(', ')}${pushed.ok ? ' (pushed)' : ' (not pushed)'}\n`,
    );
    return 0;
  } finally {
    release();
  }
}

/**
 * `commit` — make one deliberate, agent-authored stage commit.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @param {object} args Parsed CLI arguments.
 * @returns {number} Process exit code (1 on operator error).
 */
function cmdCommit(root, config, args) {
  if (!args.subject) {
    process.stderr.write('commit-buddy: --subject "…" is required for a stage commit\n');
    return 1;
  }
  const blocker = findRepoBlocker(root);
  if (blocker) {
    process.stderr.write(`commit-buddy: cannot commit (${blocker})\n`);
    return 1;
  }
  const release = acquireLock(root);
  if (!release) {
    process.stderr.write('commit-buddy: another buddy run is in progress; retry shortly\n');
    return 1;
  }

  try {
    const report = buildReport(root, config);
    if (report.groups.length === 0) {
      process.stdout.write('commit-buddy: nothing safe to commit\n');
      return 0;
    }
    const requested = args.workstream ? args.workstream.split(',').map((id) => id.trim()).filter(Boolean) : null;
    if (!requested && report.groups.length > 1) {
      process.stderr.write(
        `commit-buddy: ${report.groups.length} workstreams are dirty (${report.groups.map((group) => group.id).join(', ')}). ` +
          'Pass --workstream <id>[,<id>] so unrelated work is not mixed into one commit.\n',
      );
      return 1;
    }
    const selected = requested
      ? report.groups.filter((group) => requested.includes(group.id))
      : report.groups;
    if (selected.length === 0) {
      process.stderr.write(
        `commit-buddy: no dirty files for ${requested.join(', ')} (dirty: ${report.groups.map((group) => group.id).join(', ') || 'none'})\n`,
      );
      return 1;
    }

    const paths = selected.flatMap((group) => group.paths);
    const scan = scanForSecrets(root, paths, config);
    if (scan.clean.length === 0) {
      process.stderr.write('commit-buddy: every candidate path was withheld as unsafe\n');
      return 1;
    }
    const primary = selected[0];
    const notes = readNotes(root);
    const groupNotes = [...new Set(selected.flatMap((group) => notesForWorkstream(notes, group.id)))];
    const group = { id: selected.map((entry) => entry.id).join('+'), label: primary.label, paths: scan.clean };
    const { branch, project: branchProject } = resolveBranchProject(root, config);
    const message = buildStageMessage({
      subject: args.subject,
      body: args.body,
      group,
      notes: groupNotes,
      branchProject,
      branch,
    });
    const result = commitGroup(root, group, message);
    if (!result.ok) {
      process.stderr.write(`commit-buddy: ${result.reason}\n`);
      return 1;
    }
    writeNotes(root, notes.filter((note) => !groupNotes.includes(note)));
    resetJournal(root);
    log(root, `stage commit ${result.sha} for ${group.id} (${scan.clean.length} files)`);

    const withheld = [
      ...report.withheld,
      ...scan.flagged.map((item) => ({ filePath: item.filePath, reason: `matched secret pattern ${item.patternId}` })),
    ];
    for (const item of withheld) process.stdout.write(`commit-buddy: withheld ${item.filePath} — ${item.reason}\n`);

    const pushed = args.noPush ? { ok: false, skipped: '--no-push' } : pushCurrentBranch(root, config);
    if (pushed.reason) process.stderr.write(`commit-buddy: ${pushed.reason}${pushed.detail ? ` — ${pushed.detail}` : ''}\n`);
    saveState(root, { ...loadState(root), lastStageCommitAt: new Date().toISOString(), lastPush: pushed });
    process.stdout.write(
      `commit-buddy: committed ${result.sha} (${group.id}, ${scan.clean.length} files)${pushed.ok ? ' and pushed' : ''}\n`,
    );
    return 0;
  } finally {
    release();
  }
}

/**
 * `note` — record a finished stage for the next commit body.
 *
 * @param {string} root Repository root directory.
 * @param {object} args Parsed CLI arguments.
 * @returns {number} Process exit code.
 */
function cmdNote(root, args) {
  const text = (args.positional.join(' ') || args.text || '').trim();
  if (!text) {
    process.stderr.write('commit-buddy: note text is required\n');
    return 1;
  }
  const notes = readNotes(root);
  notes.push({ ts: new Date().toISOString(), workstream: args.workstream ?? 'all', text });
  if (!writeNotes(root, notes)) {
    process.stderr.write('commit-buddy: could not write the stage note; check .cursor/commit-buddy/ permissions\n');
    return 1;
  }
  process.stdout.write(`commit-buddy: recorded stage note (${notes.length} pending)\n`);
  return 0;
}

/**
 * `sync` — push any unpushed commits on the current branch.
 *
 * @param {string} root Repository root directory.
 * @param {object} config Effective configuration.
 * @returns {number} Process exit code.
 */
function cmdSync(root, config) {
  if (findDisabledReason(root, config) || findRepoBlocker(root)) return 0;
  const pushed = pushCurrentBranch(root, config);
  log(root, `sync push: ${JSON.stringify(pushed)}`);
  if (pushed.ok && !pushed.skipped) process.stdout.write('commit-buddy: pushed pending commits\n');
  return 0;
}

/**
 * `on` / `off` — toggle the local kill switch.
 *
 * @param {string} root Repository root directory.
 * @param {boolean} enable True to enable, false to disable.
 * @returns {number} Process exit code.
 */
function cmdToggle(root, enable) {
  const file = path.join(stateDir(root), 'disabled');
  if (enable) {
    rmSync(file, { force: true });
    process.stdout.write('commit-buddy: enabled\n');
  } else {
    writeFileSync(file, `disabled ${new Date().toISOString()}\n`);
    process.stdout.write('commit-buddy: disabled (run `npm run buddy:on` to resume)\n');
  }
  return 0;
}

/**
 * Parse CLI arguments into a flag object.
 *
 * @param {string[]} argv Raw argument list (without node/script).
 * @returns {object} Parsed arguments with `command` and `positional`.
 */
function parseArgs(argv) {
  const args = { command: argv[0] ?? 'check', positional: [], json: false, noPush: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--json':
        args.json = true;
        break;
      case '--no-push':
        args.noPush = true;
        break;
      case '--subject':
      case '--body':
      case '--workstream':
      case '--trigger':
      case '--text': {
        const key = token.replace(/^--/, '');
        args[key] = argv[index + 1];
        index += 1;
        break;
      }
      default:
        args.positional.push(token);
    }
  }
  return args;
}

/**
 * CLI entry point.
 *
 * @returns {number} Process exit code.
 */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = findRepoRoot();
  if (!root) {
    process.stderr.write('commit-buddy: not inside a git repository\n');
    return 0;
  }
  const config = loadConfig(root);
  switch (args.command) {
    case 'check':
      return cmdCheck(root, config, args);
    case 'auto':
      return cmdAuto(root, config, args);
    case 'commit':
      return cmdCommit(root, config, args);
    case 'note':
      return cmdNote(root, args);
    case 'sync':
      return cmdSync(root, config);
    case 'on':
      return cmdToggle(root, true);
    case 'off':
      return cmdToggle(root, false);
    default:
      process.stderr.write(`commit-buddy: unknown command "${args.command}"\n`);
      return 1;
  }
}

process.exitCode = main();
