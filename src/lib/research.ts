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
