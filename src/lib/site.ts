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
	/** University banner on the homepage hero. */
	banner: '/images/milad-lab-banner.jpg',
	/** MILAB wordmark used in the site header. */
	logo: '/images/milad-lab-logo.png',
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
