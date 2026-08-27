import publicationsData from '../data/publications.json';
import projectsData from '../data/projects.json';

/** A publication entry generated from ORCID / Crossref sync. */
export interface Publication {
	id: string;
	title: string;
	authors: string;
	year: number;
	venue: string;
	doi?: string;
	url?: string;
	type: 'journal' | 'preprint' | 'chapter' | 'other';
	featured: boolean;
	source: string;
}

/** A current-project theme derived from recent publications. */
export interface Project {
	id: string;
	title: string;
	status: 'active' | 'completed';
	summary: string;
	startYear: number;
	order: number;
	publicationIds: string[];
	body: string;
}

/**
 * Returns synced publication metadata and the ordered publication list.
 */
export function getPublicationsBundle(): {
	syncedAt: string;
	source: (typeof publicationsData)['source'];
	publications: Publication[];
} {
	return {
		syncedAt: publicationsData.syncedAt,
		source: publicationsData.source,
		publications: publicationsData.publications as Publication[],
	};
}

/**
 * Returns all publications newest-first (already sorted by sync).
 */
export function getPublications(): Publication[] {
	return getPublicationsBundle().publications;
}

/**
 * Returns featured publications for a short list on the home page.
 */
export function getFeaturedPublications(): Publication[] {
	return getPublications().filter((pub) => pub.featured);
}

/**
 * Main-author titles for the public Publications tab, in the order they
 * should appear on /publications. Matched against synced records; do not
 * invent metadata for missing titles.
 */
export const MAIN_AUTHOR_PUBLICATION_TITLES = [
	'Revisiting the role of pulmonary surfactant in chronic inflammatory lung diseases and environmental exposure',
	'Cannabis smoke suppresses antiviral immune responses to influenza A in mice',
	'Open-source, three-dimensionally printed manifolds for exposure studies using human airway epithelial cells',
	'Neutrophils and IL-1α Regulate Surfactant Homeostasis during Cigarette Smoking',
	'Dried Cannabis Use, Tobacco Smoking, and COVID-19 Infection: Findings from a Longitudinal Observational Cohort Study',
	'Recombinant human β-defensin 2 delivery improves smoking-induced lung neutrophilia and bacterial exacerbation',
	'Smoking status impacts treatment efficacy in smoke-induced lung inflammation: A pre-clinical study',
	'Lung Tissue Transcriptomics Reveal Associations Between Thymic Stromal Lymphopoietin Signaling, Mast Cells, and Airway Obstruction in Active Smokers',
	'Increased plasma lipid levels exacerbate muscle pathology in the mdx mouse model of Duchenne muscular dystrophy',
	'A mutation in PTPN6 associated to emphysema alters B-lymphocyte biology in humans and mice',
] as const;

/**
 * Normalizes a publication title for fuzzy matching across dash and whitespace variants.
 * @param title - Raw title from the curated list or synced record
 */
export function normalizePublicationTitle(title: string): string {
	return title.replace(/\s+/g, ' ').replace(/[‐‑–—]/g, '-').trim().toLowerCase();
}

/**
 * Sorts publications newest-first by year, keeping the incoming order
 * as a stable secondary key when years are equal.
 * @param publications - Publication records to sort
 */
export function sortPublicationsNewestFirst(publications: Publication[]): Publication[] {
	return publications
		.map((publication, index) => ({ publication, index }))
		.sort((a, b) => b.publication.year - a.publication.year || a.index - b.index)
		.map(({ publication }) => publication);
}

/**
 * Returns curated main-author publications in MAIN_AUTHOR_PUBLICATION_TITLES
 * order. Titles with no match in the synced dataset are omitted.
 */
export function getMainAuthorPublications(): Publication[] {
	const byTitle = new Map(
		getPublications().map((pub) => [normalizePublicationTitle(pub.title), pub]),
	);

	return MAIN_AUTHOR_PUBLICATION_TITLES.flatMap((title) => {
		const match = byTitle.get(normalizePublicationTitle(title));
		return match ? [match] : [];
	});
}

/**
 * Returns titles from the curated main-author list that are absent from the synced dataset.
 */
export function getMissingMainAuthorTitles(): string[] {
	const present = new Set(
		getPublications().map((pub) => normalizePublicationTitle(pub.title)),
	);
	return MAIN_AUTHOR_PUBLICATION_TITLES.filter(
		(title) => !present.has(normalizePublicationTitle(title)),
	);
}

/**
 * Groups publications by year, newest year first, preserving within-year order.
 * @param publications - Publication records to group
 */
export function groupPublicationsByYear(
	publications: Publication[],
): Array<{ year: number; publications: Publication[] }> {
	const years = [...new Set(publications.map((pub) => pub.year))].sort((a, b) => b - a);
	return years.map((year) => ({
		year,
		publications: publications.filter((pub) => pub.year === year),
	}));
}

/**
 * Returns auto-derived project themes and sync metadata.
 */
export function getProjectsBundle(): {
	syncedAt: string;
	windowYears: number;
	cutoffYear: number;
	sourcePublicationCount: number;
	projects: Project[];
} {
	return {
		syncedAt: projectsData.syncedAt,
		windowYears: projectsData.windowYears,
		cutoffYear: projectsData.cutoffYear,
		sourcePublicationCount: projectsData.sourcePublicationCount,
		projects: projectsData.projects as Project[],
	};
}

/**
 * Returns project themes sorted by configured order.
 */
export function getProjects(): Project[] {
	return getProjectsBundle().projects;
}

/**
 * Builds a DOI or external URL for a publication when available.
 */
export function publicationHref(pub: Publication): string | undefined {
	if (pub.url) {
		return pub.url;
	}
	if (pub.doi) {
		return `https://doi.org/${pub.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`;
	}
	return undefined;
}
