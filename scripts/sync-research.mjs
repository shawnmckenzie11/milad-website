#!/usr/bin/env node
/**
 * Syncs publications for Dr. Nadia Milad and derives Current Projects themes
 * from the last five years of those works.
 *
 * ResearchGate (https://www.researchgate.net/profile/Nadia-Milad) blocks scrapers.
 * This script merges OpenAlex (author linked to ORCID 0000-0002-1497-8224) with a
 * collaborator-filtered PubMed harvest, then enriches DOIs via Crossref.
 *
 * Usage: node scripts/sync-research.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');

const ORCID_ID = '0000-0002-1497-8224';
const OPENALEX_AUTHOR_ID = 'A5085320633';
const RESEARCHGATE_URL = 'https://www.researchgate.net/profile/Nadia-Milad';
const USER_AGENT = 'milad-website/0.1 (mailto:miladn1@mcmaster.ca; academic site sync)';
const MAILTO = 'miladn1@mcmaster.ca';

/**
 * PubMed query keyed to known coauthors so unrelated “Milad N” homonyms are excluded.
 */
const PUBMED_QUERY =
	'(Milad N[Author]) AND (Hirota J[Author] OR Morissette M[Author] OR Bernatchez P[Author] OR Pineault M[Author] OR MacKillop J[Author] OR Miura Y[Author] OR Kanazawa S[Author] OR White Z[Author] OR Sellers S[Author] OR Jubinville[Author] OR Lechasseur[Author] OR Nyberg A[Author] OR Cabrini G[Author] OR Singer R[Author] OR Nguyen JP[Author] OR Bossé Y[Author] OR Maltais F[Author])';

/** Coauthor / affiliation tokens used to drop homonym papers after merge. */
const KNOWN_COLLABORATOR_PATTERN =
	/\b(Hirota|Morissette|Bernatchez|Pineault|MacKillop|Miura|Kanazawa|White Z|Sellers|Jubinville|Lechasseur|Nyberg|Cabrini|Singer|Nguyen|Bossé|Bosse|Maltais|Tremblay F|Beaulieu|Aubin|Fantauzzi|Donen|Tehrani|Esfandiarei|Usami|Kosugi|Noguchi)\b/i;

/**
 * Keyword themes used to summarize last-five-years publications into projects.
 * Order matters: first matching theme wins.
 */
const PROJECT_THEMES = [
	{
		id: 'cannabis-respiratory-health',
		title: 'Cannabis exposure and respiratory health',
		status: 'active',
		order: 1,
		keywords: [/cannabis/i],
		summary:
			'Investigating how cannabis smoke and dried cannabis use intersect with antiviral immunity, tobacco co-use, and respiratory outcomes.',
	},
	{
		id: 'vaping-toxicology',
		title: 'Vaping product chemistry and airway immunity',
		status: 'active',
		order: 2,
		keywords: [/vap(e|ing)/i, /e-?cig/i, /flavor chemical/i, /glycerol/i],
		summary:
			'Studying how constituents of vaping liquids—including flavor chemicals and glycerol—shape pulmonary immune responses and metabolic effects.',
	},
	{
		id: 'smoke-lung-inflammation',
		title: 'Cigarette smoke, inflammation, and lung homeostasis',
		status: 'active',
		order: 3,
		keywords: [
			/smok(e|ing|ers)/i,
			/cigarette/i,
			/neutrophil/i,
			/surfactant/i,
			/lung inflammation/i,
			/emphysema/i,
			/COPD/i,
			/thymic stromal/i,
			/defensin/i,
			/PTPN6/i,
			/bleomycin/i,
			/senescence/i,
			/fibrosis/i,
		],
		summary:
			'Mechanistic work on smoke-driven lung inflammation, genetic emphysema risk, immune cell signaling, surfactant biology, and treatment responses in preclinical and tissue models.',
	},
	{
		id: 'airway-methods',
		title: 'Open methods for airway exposure studies',
		status: 'active',
		order: 4,
		keywords: [
			/open-source/i,
			/three-dimensionally printed/i,
			/3D printed/i,
			/manifold/i,
			/respiratory pharmacology/i,
			/CFTR/i,
			/Calu-3/i,
			/airway epithelial/i,
			/apical fluid/i,
		],
		summary:
			'Building accessible experimental tools and methods for human airway epithelial research, including exposure systems and epithelial physiology assays.',
	},
	{
		id: 'neuromuscular-vascular',
		title: 'Neuromuscular and vascular disease models',
		status: 'completed',
		order: 5,
		keywords: [
			/duchenne/i,
			/mdx/i,
			/dysferlin/i,
			/marfan/i,
			/angiotensin/i,
			/losartan/i,
			/valsartan/i,
			/muscle/i,
			/atherosclerosis/i,
			/sildenafil/i,
			/statins/i,
			/hyperlipidemia/i,
		],
		summary:
			'Collaborative work on muscular dystrophy, Marfan-related vascular remodeling, and related metabolic or pharmacological interventions.',
	},
];

/**
 * Fetches JSON from a URL with a descriptive User-Agent.
 * @param {string} url
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<unknown>}
 */
async function fetchJson(url, extraHeaders = {}) {
	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
			...extraHeaders,
		},
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return response.json();
}

/**
 * Strips HTML tags and collapses whitespace in titles.
 * @param {string} value
 * @returns {string}
 */
function cleanText(value) {
	return value
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Normalizes a DOI string to a bare lowercase DOI.
 * @param {string} doi
 * @returns {string}
 */
function normalizeDoi(doi) {
	return doi
		.trim()
		.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
		.toLowerCase();
}

/**
 * Formats author names as "Family I, Family I".
 * @param {string[]} names
 * @returns {string}
 */
function formatAuthorNames(names) {
	if (!names.length) return 'Milad N et al.';
	return names
		.map((name) => {
			const parts = name.trim().split(/\s+/);
			if (parts.length === 1) return parts[0];
			const family = parts[parts.length - 1];
			const given = parts[0];
			return `${family} ${given[0]}`;
		})
		.join(', ');
}

/**
 * Maps source work types onto site publication types.
 * @param {string | undefined} type
 * @returns {'journal' | 'preprint' | 'chapter' | 'other'}
 */
function mapWorkType(type) {
	const value = (type || '').toLowerCase();
	if (value.includes('preprint')) return 'preprint';
	if (value.includes('chapter') || value.includes('book')) return 'chapter';
	if (
		value.includes('article') ||
		value.includes('editorial') ||
		value.includes('letter') ||
		value.includes('review') ||
		value.includes('journal')
	) {
		return 'journal';
	}
	if (value.includes('dissertation') || value.includes('thesis')) return 'other';
	return 'other';
}

/**
 * Returns whether an OpenAlex/PubMed record should appear on the public site.
 * @param {{ title: string, doi?: string, type?: string, authors?: string }} work
 * @returns {boolean}
 */
function isPublicPublication(work) {
	const title = (work.title || '').toLowerCase();
	const doi = (work.doi || '').toLowerCase();
	const type = (work.type || '').toLowerCase();

	if (!work.title) return false;
	if (title.startsWith('additional file')) return false;
	if (doi.includes('figshare')) return false;
	// FASEB / ATS style meeting abstracts often look like articles in OpenAlex.
	if (doi.includes('supplement') || doi.includes('meetingabstracts') || doi.includes('_supp.')) {
		return false;
	}
	if (type.includes('conference') || type.includes('poster') || type.includes('abstract')) {
		return false;
	}
	if (type.includes('paratext')) return false;

	// Solo dissertation is allowed; otherwise require a known collaborator signal.
	const isThesis = type.includes('dissertation') || type.includes('thesis');
	if (!isThesis && work.authors && !KNOWN_COLLABORATOR_PATTERN.test(work.authors)) {
		return false;
	}

	const allowed =
		type.includes('article') ||
		type.includes('editorial') ||
		type.includes('letter') ||
		type.includes('review') ||
		type.includes('preprint') ||
		type.includes('dissertation') ||
		type.includes('thesis') ||
		type === '' ||
		type.includes('journal');

	return allowed;
}

/**
 * Fetches all OpenAlex works for the configured author.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function fetchOpenAlexWorks() {
	const works = [];
	let cursor = '*';

	while (cursor) {
		const url = new URL('https://api.openalex.org/works');
		url.searchParams.set('filter', `author.id:${OPENALEX_AUTHOR_ID}`);
		url.searchParams.set('per_page', '200');
		url.searchParams.set('cursor', cursor);
		url.searchParams.set('mailto', MAILTO);

		const data = await fetchJson(url.toString());
		const batch = data?.results ?? [];
		works.push(...batch);
		cursor = data?.meta?.next_cursor || null;
		if (!batch.length) break;
	}

	return works;
}

/**
 * Maps an OpenAlex work into a normalized publication draft.
 * @param {Record<string, unknown>} work
 * @returns {{
 *   title: string,
 *   year?: number,
 *   type: string,
 *   venue?: string,
 *   doi?: string,
 *   authors: string,
 *   url?: string,
 *   source: string
 * } | null}
 */
function fromOpenAlex(work) {
	const title = cleanText(String(work.title || ''));
	const doiRaw = typeof work.doi === 'string' ? work.doi : undefined;
	const doi = doiRaw ? normalizeDoi(doiRaw) : undefined;
	const type = String(work.type || 'article');
	const draft = { title, doi, type };
	if (!isPublicPublication(draft)) return null;

	const authors = formatAuthorNames(
		(work.authorships || [])
			.map((entry) => entry?.author?.display_name)
			.filter((name) => typeof name === 'string' && name.length > 0),
	);

	const venue =
		work?.primary_location?.source?.display_name ||
		work?.host_venue?.display_name ||
		undefined;

	const year = typeof work.publication_year === 'number' ? work.publication_year : undefined;
	const url =
		(typeof work?.primary_location?.landing_page_url === 'string' &&
			work.primary_location.landing_page_url) ||
		(doi ? `https://doi.org/${doi}` : undefined);

	return {
		title,
		year,
		type,
		venue,
		doi,
		authors,
		url,
		source: 'openalex',
	};
}

/**
 * Searches PubMed and returns summary records for matching PMIDs.
 * @returns {Promise<Array<{
 *   title: string,
 *   year?: number,
 *   type: string,
 *   venue?: string,
 *   doi?: string,
 *   authors: string,
 *   url?: string,
 *   source: string
 * }>>}
 */
async function fetchPubmedWorks() {
	const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
	searchUrl.searchParams.set('db', 'pubmed');
	searchUrl.searchParams.set('retmax', '200');
	searchUrl.searchParams.set('retmode', 'json');
	searchUrl.searchParams.set('term', PUBMED_QUERY);

	const search = await fetchJson(searchUrl.toString());
	const ids = search?.esearchresult?.idlist ?? [];
	if (!ids.length) return [];

	const drafts = [];
	for (let i = 0; i < ids.length; i += 40) {
		const batch = ids.slice(i, i + 40);
		const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
		summaryUrl.searchParams.set('db', 'pubmed');
		summaryUrl.searchParams.set('retmode', 'json');
		summaryUrl.searchParams.set('id', batch.join(','));

		const summary = await fetchJson(summaryUrl.toString());
		const result = summary?.result ?? {};
		for (const pmid of batch) {
			const record = result[pmid];
			if (!record) continue;
			const title = cleanText(String(record.title || ''));
			const doiEntry = (record.articleids || []).find((item) => item.idtype === 'doi');
			const doi = doiEntry?.value ? normalizeDoi(doiEntry.value) : undefined;
			const yearMatch = String(record.pubdate || '').match(/\b(19|20)\d{2}\b/);
			const year = yearMatch ? Number.parseInt(yearMatch[0], 10) : undefined;
			const authors = (record.authors || [])
				.map((author) => author.name)
				.filter(Boolean)
				.join(', ');
			const draft = {
				title,
				year,
				type: 'journal-article',
				venue: record.fulljournalname || record.source,
				doi,
				authors: authors || 'Milad N et al.',
				url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
				source: 'pubmed',
			};
			if (isPublicPublication(draft)) {
				drafts.push(draft);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 340));
	}

	return drafts;
}

/**
 * Enriches a draft with Crossref metadata when a DOI is present.
 * @param {{
 *   title: string,
 *   year?: number,
 *   type: string,
 *   venue?: string,
 *   doi?: string,
 *   authors: string,
 *   url?: string,
 *   source: string
 * }} work
 * @returns {Promise<{
 *   id: string,
 *   title: string,
 *   authors: string,
 *   year: number,
 *   venue: string,
 *   doi?: string,
 *   url?: string,
 *   type: 'journal' | 'preprint' | 'chapter' | 'other',
 *   featured: boolean,
 *   source: string
 * } | null>}
 */
async function enrichWork(work) {
	let { authors, venue, url, year, title } = work;

	if (work.doi) {
		try {
			const payload = await fetchJson(
				`https://api.crossref.org/works/${encodeURIComponent(work.doi)}`,
			);
			const message = payload?.message;
			if (message?.author?.length) {
				authors = message.author
					.map((author) => {
						const family = author.family?.trim();
						const given = author.given?.trim();
						if (family && given) return `${family} ${given[0]}`;
						return family || given || '';
					})
					.filter(Boolean)
					.join(', ');
			}
			venue =
				venue ||
				message?.['container-title']?.[0] ||
				message?.['short-container-title']?.[0] ||
				undefined;
			url = url || message?.URL || `https://doi.org/${work.doi}`;
			if (!year && message?.issued?.['date-parts']?.[0]?.[0]) {
				year = message.issued['date-parts'][0][0];
			}
			if (message?.title?.[0]) {
				title = cleanText(message.title[0]);
			}
		} catch (error) {
			console.warn(`Crossref lookup failed for ${work.doi}:`, error.message);
			url = url || `https://doi.org/${work.doi}`;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	if (!year) {
		console.warn(`Skipping work without year: ${title}`);
		return null;
	}

	const id = work.doi
		? work.doi.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
		: `pub-${year}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`;

	return {
		id,
		title,
		authors: authors || 'Milad N et al.',
		year,
		venue: venue || 'Journal article',
		doi: work.doi,
		url,
		type: mapWorkType(work.type),
		featured: year >= new Date().getFullYear() - 2,
		source: work.source,
	};
}

/**
 * Merges drafts by DOI (or title+year), preferring richer records.
 * @param {Array<ReturnType<typeof fromOpenAlex>>} drafts
 * @returns {typeof drafts}
 */
function dedupeDrafts(drafts) {
	/** @type {Map<string, NonNullable<ReturnType<typeof fromOpenAlex>>>} */
	const byKey = new Map();

	for (const draft of drafts) {
		if (!draft) continue;
		const key = draft.doi
			? `doi:${draft.doi}`
			: `title:${draft.year}:${draft.title.toLowerCase()}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, draft);
			continue;
		}
		byKey.set(key, {
			...existing,
			...draft,
			authors:
				draft.authors && draft.authors !== 'Milad N et al.'
					? draft.authors
					: existing.authors,
			venue: draft.venue || existing.venue,
			url: draft.url || existing.url,
			year: draft.year || existing.year,
			source: `${existing.source}+${draft.source}`,
		});
	}

	return [...byKey.values()];
}

/**
 * Drops preprints that were later published under a different DOI with the same title stem.
 * @param {Array<{ title: string, type: string, year: number, doi?: string }>} publications
 * @returns {typeof publications}
 */
/**
 * Collapses title text for fuzzy preprint↔journal matching.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitleKey(title) {
	return title
		.toLowerCase()
		.replace(/three-?dimensionally/g, '3d')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Drops preprints that were later published under a different DOI.
 * @param {Array<{ title: string, type: string, year: number, doi?: string }>} publications
 * @returns {typeof publications}
 */
function dropSupersededPreprints(publications) {
	const publishedTitles = publications
		.filter((pub) => pub.type === 'journal')
		.map((pub) => normalizeTitleKey(pub.title));

	return publications.filter((pub) => {
		if (pub.type !== 'preprint') return true;
		const normalized = normalizeTitleKey(pub.title);
		return !publishedTitles.some((published) => {
			const a = published.slice(0, 40);
			const b = normalized.slice(0, 40);
			return published.includes(b) || normalized.includes(a) || a === b;
		});
	});
}

/**
 * Returns publications from the inclusive last five calendar years.
 * @param {Array<{ year: number }>} publications
 * @returns {typeof publications}
 */
function publicationsLastFiveYears(publications) {
	const cutoff = new Date().getFullYear() - 5;
	return publications.filter((pub) => pub.year >= cutoff);
}

/**
 * Assigns a publication to the first matching project theme.
 * @param {{ title: string, venue: string }} publication
 * @returns {(typeof PROJECT_THEMES)[number] | undefined}
 */
function matchTheme(publication) {
	const haystack = `${publication.title} ${publication.venue}`;
	return PROJECT_THEMES.find((theme) => theme.keywords.some((re) => re.test(haystack)));
}

/**
 * Builds project summaries from recent publications via keyword themes.
 * @param {Array<{ id: string, title: string, year: number, venue: string }>} publications
 */
function deriveProjects(publications) {
	const recent = publicationsLastFiveYears(publications);
	/** @type {Map<string, { theme: (typeof PROJECT_THEMES)[number], pubs: typeof recent }>} */
	const buckets = new Map();

	for (const pub of recent) {
		const theme = matchTheme(pub) ?? {
			id: 'other-recent',
			title: 'Collaborative respiratory research',
			status: 'active',
			order: 99,
			keywords: [],
			summary: 'Collaborative studies in respiratory physiology and related clinical research.',
		};

		const existing = buckets.get(theme.id);
		if (existing) {
			existing.pubs.push(pub);
		} else {
			buckets.set(theme.id, { theme, pubs: [pub] });
		}
	}

	return [...buckets.values()]
		.map(({ theme, pubs }) => {
			const sorted = [...pubs].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
			const years = sorted.map((p) => p.year);
			const startYear = Math.min(...years);
			const related = sorted
				.slice(0, 5)
				.map((p) => `- ${p.year} — ${p.title}`)
				.join('\n');

			return {
				id: theme.id,
				title: theme.title,
				status: theme.status,
				summary: theme.summary,
				startYear,
				order: theme.order,
				publicationIds: sorted.map((p) => p.id),
				body: `Selected publications:\n${related}`,
			};
		})
		.sort((a, b) => a.order - b.order || b.startYear - a.startYear);
}

/**
 * Writes generated publication and project JSON for the Astro site.
 */
async function main() {
	console.log(`ResearchGate profile (human source): ${RESEARCHGATE_URL}`);
	console.log(`Fetching OpenAlex works for ${OPENALEX_AUTHOR_ID} (ORCID ${ORCID_ID})…`);

	const openAlexRaw = await fetchOpenAlexWorks();
	const openAlexDrafts = openAlexRaw.map(fromOpenAlex).filter(Boolean);
	console.log(`OpenAlex: ${openAlexRaw.length} raw → ${openAlexDrafts.length} public works`);

	console.log('Fetching PubMed collaborator-filtered works…');
	const pubmedDrafts = await fetchPubmedWorks();
	console.log(`PubMed: ${pubmedDrafts.length} public works`);

	const merged = dedupeDrafts([...openAlexDrafts, ...pubmedDrafts]);
	console.log(`Merged unique drafts: ${merged.length}`);

	const publications = [];
	for (const draft of merged) {
		const enriched = await enrichWork(draft);
		if (enriched) publications.push(enriched);
	}

	const filtered = dropSupersededPreprints(publications);
	filtered.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

	const projects = deriveProjects(filtered);

	await mkdir(DATA_DIR, { recursive: true });

	const syncedAt = new Date().toISOString();
	const publicationsPayload = {
		syncedAt,
		source: {
			label: 'ResearchGate profile (via OpenAlex + PubMed)',
			researchGate: RESEARCHGATE_URL,
			orcid: `https://orcid.org/${ORCID_ID}`,
			orcidId: ORCID_ID,
			openAlexAuthor: `https://openalex.org/${OPENALEX_AUTHOR_ID}`,
			note: 'ResearchGate blocks automated harvesting; OpenAlex/PubMed supply the open bibliographic record for the same researcher.',
		},
		publications: filtered,
	};

	const projectsPayload = {
		syncedAt,
		windowYears: 5,
		cutoffYear: new Date().getFullYear() - 5,
		sourcePublicationCount: publicationsLastFiveYears(filtered).length,
		projects,
	};

	await writeFile(
		path.join(DATA_DIR, 'publications.json'),
		`${JSON.stringify(publicationsPayload, null, 2)}\n`,
	);
	await writeFile(
		path.join(DATA_DIR, 'projects.json'),
		`${JSON.stringify(projectsPayload, null, 2)}\n`,
	);

	const byYear = filtered.reduce((acc, pub) => {
		acc[pub.year] = (acc[pub.year] || 0) + 1;
		return acc;
	}, {});

	console.log(`Wrote ${filtered.length} publications → src/data/publications.json`);
	console.log('By year:', byYear);
	console.log(`Wrote ${projects.length} projects → src/data/projects.json`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
