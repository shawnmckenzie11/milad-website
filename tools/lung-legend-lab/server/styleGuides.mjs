/**
 * Style-guide profile catalog for lung-legend-lab analyses.
 *
 * Profiles live under tools/lung-legend-lab/style-guide-profiles/ as versioned
 * JSON + Markdown. Analyses store a styleGuideProfileId pointer in meta.json.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { STYLE_GUIDE_PROFILES_DIR, toRepoRel } from './paths.mjs';

/** Catalog filename inside the profiles directory. */
const INDEX_FILE = 'index.json';

/** Built-in default when catalog or analysis omits a profile. */
export const DEFAULT_STYLE_GUIDE_PROFILE_ID = 'milad-lab-biomedical-illustration';

/**
 * Absolute path to the style-guide profile catalog file.
 * @returns {string}
 */
function indexPath() {
	return path.join(STYLE_GUIDE_PROFILES_DIR, INDEX_FILE);
}

/**
 * Read the profile catalog (default id + summary list).
 * @returns {Promise<{defaultProfileId: string, profiles: object[]}>}
 */
export async function readStyleGuideCatalog() {
	try {
		const raw = JSON.parse(await fsp.readFile(indexPath(), 'utf8'));
		return {
			defaultProfileId: raw.defaultProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID,
			profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
		};
	} catch {
		return {
			defaultProfileId: DEFAULT_STYLE_GUIDE_PROFILE_ID,
			profiles: [
				{
					id: DEFAULT_STYLE_GUIDE_PROFILE_ID,
					title: 'Milad Lab Biomedical Illustration',
					version: '1.0.0',
					summary: 'Default atlas style guide.',
					jsonFile: `${DEFAULT_STYLE_GUIDE_PROFILE_ID}.json`,
					markdownFile: `${DEFAULT_STYLE_GUIDE_PROFILE_ID}.md`,
				},
			],
		};
	}
}

/**
 * Resolve a profile id against the catalog; fall back to default.
 * @param {string | null | undefined} profileId
 * @returns {Promise<string>}
 */
export async function resolveStyleGuideProfileId(profileId) {
	const catalog = await readStyleGuideCatalog();
	if (profileId && catalog.profiles.some((p) => p.id === profileId)) {
		return profileId;
	}
	return catalog.defaultProfileId || DEFAULT_STYLE_GUIDE_PROFILE_ID;
}

/**
 * Load the full structured profile JSON (and markdown path metadata).
 * @param {string | null | undefined} profileId
 * @returns {Promise<object | null>}
 */
export async function loadStyleGuideProfile(profileId) {
	const catalog = await readStyleGuideCatalog();
	const id = await resolveStyleGuideProfileId(profileId);
	const entry = catalog.profiles.find((p) => p.id === id) || catalog.profiles[0];
	if (!entry?.jsonFile) return null;

	const jsonAbs = path.join(STYLE_GUIDE_PROFILES_DIR, entry.jsonFile);
	if (!fs.existsSync(jsonAbs)) return null;

	const profile = JSON.parse(await fsp.readFile(jsonAbs, 'utf8'));
	const mdRel = entry.markdownFile
		? toRepoRel(path.join(STYLE_GUIDE_PROFILES_DIR, entry.markdownFile))
		: null;
	let markdown = null;
	if (entry.markdownFile) {
		const mdAbs = path.join(STYLE_GUIDE_PROFILES_DIR, entry.markdownFile);
		if (fs.existsSync(mdAbs)) {
			markdown = await fsp.readFile(mdAbs, 'utf8');
		}
	}

	return {
		...profile,
		id: profile.id || id,
		catalogTitle: entry.title || profile.title,
		markdownRel: mdRel,
		markdown,
		jsonRel: toRepoRel(jsonAbs),
	};
}

/**
 * Summaries safe to ship in /api/state (no full markdown body).
 * @returns {Promise<object[]>}
 */
export async function listStyleGuideProfileSummaries() {
	const catalog = await readStyleGuideCatalog();
	const out = [];
	for (const entry of catalog.profiles) {
		const full = await loadStyleGuideProfile(entry.id);
		out.push({
			id: entry.id,
			title: entry.title || full?.title || entry.id,
			version: entry.version || full?.version || null,
			summary: entry.summary || full?.summary || '',
			uiBrief: full?.uiBrief || null,
			jsonRel: full?.jsonRel || null,
			markdownRel: full?.markdownRel || null,
		});
	}
	return out;
}

/**
 * Compact active-profile payload for the lab UI (brief + naming, not full MD).
 * @param {string | null | undefined} profileId
 * @returns {Promise<object | null>}
 */
export async function getStyleGuideProfileBrief(profileId) {
	const profile = await loadStyleGuideProfile(profileId);
	if (!profile) return null;
	return briefFromLoadedProfile(profile);
}

/**
 * Build the UI brief object from a loaded profile (catalog or snapshot).
 * @param {object} profile
 * @returns {object}
 */
function briefFromLoadedProfile(profile) {
	return {
		id: profile.id,
		title: profile.title,
		version: profile.version,
		summary: profile.summary,
		visualLanguage: profile.visualLanguage || null,
		illustrationFramework: profile.illustrationFramework || [],
		ontology: profile.ontology || null,
		imagePathways: Array.isArray(profile.imagePathways)
			? profile.imagePathways
			: null,
		layerNaming: profile.layerNaming || null,
		siteCompatibility: profile.siteCompatibility || null,
		agentInstructions: profile.agentInstructions || [],
		imageGenPromptTemplates: profile.imageGenPromptTemplates || null,
		uiBrief: profile.uiBrief || null,
		markdownRel: profile.markdownRel || null,
		jsonRel: profile.jsonRel || null,
		appliesTo: profile.appliesTo || [],
		markdownFile: profile.markdownFile || null,
	};
}

/**
 * Copy a style-guide profile into an analysis snapshot folder (JSON + Markdown).
 * Persists the profile as used at save time so later catalog edits do not rewrite history.
 * @param {string} destDir - Absolute `…/analyses/{id}/style-guide` directory
 * @param {string | null | undefined} profileId
 * @returns {Promise<object | null>} Brief of what was written, or null if missing
 */
export async function writeStyleGuideSnapshot(destDir, profileId) {
	const profile = await loadStyleGuideProfile(profileId);
	if (!profile) return null;
	await fsp.mkdir(destDir, { recursive: true });
	const disk = profileJsonForDisk(profile);
	const jsonAbs = path.join(destDir, 'profile.json');
	const mdAbs = path.join(destDir, 'profile.md');
	await fsp.writeFile(jsonAbs, `${JSON.stringify(disk, null, 2)}\n`, 'utf8');
	const mdBody =
		typeof profile.markdown === 'string' && profile.markdown.trim()
			? profile.markdown
			: `# ${disk.title || profileId}\n\n${disk.summary || ''}\n`;
	await fsp.writeFile(mdAbs, mdBody, 'utf8');
	return briefFromLoadedProfile({
		...disk,
		markdownRel: toRepoRel(mdAbs),
		jsonRel: toRepoRel(jsonAbs),
		markdown: mdBody,
	});
}

/**
 * Load a previously snapshotted style-guide brief from an analysis folder.
 * @param {string} snapshotDir - Absolute `…/analyses/{id}/style-guide` directory
 * @returns {Promise<object | null>}
 */
export async function readStyleGuideSnapshotBrief(snapshotDir) {
	const jsonAbs = path.join(snapshotDir, 'profile.json');
	if (!fs.existsSync(jsonAbs)) return null;
	try {
		const profile = JSON.parse(await fsp.readFile(jsonAbs, 'utf8'));
		const mdAbs = path.join(snapshotDir, 'profile.md');
		const markdownRel = fs.existsSync(mdAbs) ? toRepoRel(mdAbs) : null;
		return briefFromLoadedProfile({
			...profile,
			jsonRel: toRepoRel(jsonAbs),
			markdownRel,
		});
	} catch {
		return null;
	}
}

/**
 * Slugify a title into a kebab-case profile id.
 * @param {string} title
 * @returns {string}
 */
export function slugifyStyleGuideId(title) {
	return String(title || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/**
 * Strip server-only / catalog fields before writing profile JSON to disk.
 * @param {object} profile
 * @returns {object}
 */
function profileJsonForDisk(profile) {
	const {
		catalogTitle: _c,
		markdownRel: _mr,
		jsonRel: _jr,
		markdown: _md,
		...rest
	} = profile;
	return rest;
}

/**
 * Persist the style-guide catalog index.
 * @param {{defaultProfileId: string, profiles: object[]}} catalog
 */
async function writeStyleGuideCatalog(catalog) {
	await fsp.mkdir(STYLE_GUIDE_PROFILES_DIR, { recursive: true });
	await fsp.writeFile(indexPath(), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

/**
 * Update an existing style-guide profile JSON (and optional markdown).
 * @param {string} profileId
 * @param {object} profileBody - Full or partial profile fields to merge/write
 * @param {{markdown?: string | null}} [opts]
 * @returns {Promise<object>} Updated brief
 */
export async function updateStyleGuideProfile(profileId, profileBody, opts = {}) {
	const catalog = await readStyleGuideCatalog();
	const entry = catalog.profiles.find((p) => p.id === profileId);
	if (!entry?.jsonFile) {
		throw Object.assign(new Error(`Unknown style guide profile: ${profileId}`), {
			statusCode: 404,
		});
	}

	const existing = await loadStyleGuideProfile(profileId);
	if (!existing) {
		throw Object.assign(new Error(`Missing profile files for: ${profileId}`), {
			statusCode: 404,
		});
	}

	const merged = {
		...profileJsonForDisk(existing),
		...profileJsonForDisk(profileBody || {}),
		id: profileId,
		markdownFile: entry.markdownFile || existing.markdownFile || `${profileId}.md`,
	};

	const jsonAbs = path.join(STYLE_GUIDE_PROFILES_DIR, entry.jsonFile);
	await fsp.writeFile(jsonAbs, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

	if (typeof opts.markdown === 'string' && entry.markdownFile) {
		const mdAbs = path.join(STYLE_GUIDE_PROFILES_DIR, entry.markdownFile);
		await fsp.writeFile(mdAbs, opts.markdown, 'utf8');
	}

	entry.title = merged.title || entry.title;
	entry.version = merged.version || entry.version;
	entry.summary = merged.summary || entry.summary;
	await writeStyleGuideCatalog(catalog);

	return getStyleGuideProfileBrief(profileId);
}

/**
 * Create a new style-guide profile (save as new) from a draft body.
 * @param {object} params
 * @param {string} [params.id] - Optional kebab id; derived from title when omitted
 * @param {object} params.profile - Profile fields (copied from an existing draft)
 * @param {string | null} [params.markdown]
 * @returns {Promise<{id: string, brief: object}>}
 */
export async function createStyleGuideProfile({ id, profile, markdown = null }) {
	const catalog = await readStyleGuideCatalog();
	const title = profile?.title || 'Untitled style guide';
	let newId = (id || slugifyStyleGuideId(title) || 'style-guide').trim();
	if (!/^[a-z][a-z0-9-]{1,79}$/.test(newId)) {
		throw Object.assign(
			new Error('Profile id must be kebab-case (start with a letter)'),
			{ statusCode: 400 },
		);
	}
	if (catalog.profiles.some((p) => p.id === newId)) {
		throw Object.assign(new Error(`Profile id already exists: ${newId}`), {
			statusCode: 409,
		});
	}

	const jsonFile = `${newId}.json`;
	const markdownFile = `${newId}.md`;
	const disk = {
		...profileJsonForDisk(profile || {}),
		id: newId,
		title,
		version: profile?.version || '1.0.0',
		summary: profile?.summary || '',
		markdownFile,
	};

	await fsp.mkdir(STYLE_GUIDE_PROFILES_DIR, { recursive: true });
	await fsp.writeFile(
		path.join(STYLE_GUIDE_PROFILES_DIR, jsonFile),
		`${JSON.stringify(disk, null, 2)}\n`,
		'utf8',
	);

	const mdBody =
		typeof markdown === 'string' && markdown.trim()
			? markdown
			: `# ${title}\n\n${disk.summary || ''}\n`;
	await fsp.writeFile(path.join(STYLE_GUIDE_PROFILES_DIR, markdownFile), mdBody, 'utf8');

	catalog.profiles.push({
		id: newId,
		title: disk.title,
		version: disk.version,
		summary: disk.summary,
		jsonFile,
		markdownFile,
	});
	await writeStyleGuideCatalog(catalog);

	return { id: newId, brief: await getStyleGuideProfileBrief(newId) };
}

