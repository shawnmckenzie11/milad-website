/**
 * Shared site identity and external links for layouts and pages.
 */
export const site = {
	name: 'Dr. Nadia Milad',
	labName: 'Milad Lab',
	shortName: 'Nadia Milad',
	affiliation: 'University of Ottawa',
	email: 'miladn1@mcmaster.ca',
	researchFocus: 'Cannabis research and evidence synthesis',
	tagline:
		'Building rigorous, open tools and scholarship at the intersection of cannabis science and public health.',
	/** Stylized lung illustration on the homepage hero. */
	lungLogo: '/images/lung-logo.jpg',
	/** Portrait shown beside the homepage biography. */
	headshot: '/images/nadia-milad-headshot.jpg',
	/** MILAB wordmark used in the site header and homepage hero. */
	logo: '/images/milad-lab-logo.png',
	/** Ottawa skyline banner used as the homepage hero backdrop. */
	ottawaBanner: '/images/ottawa-skyline.jpg',
	researchGate: {
		label: 'ResearchGate',
		href: 'https://www.researchgate.net/profile/Nadia-Milad',
	},
	orcid: {
		label: 'ORCID',
		href: 'https://orcid.org/0000-0002-1497-8224',
		id: '0000-0002-1497-8224',
	},
	scraper: {
		label: 'Cannabis Research Intelligence Tool',
		href: 'https://cannabis-paper-scraper.fly.dev',
		navLabel: 'Paper scraper',
	},
} as const;
