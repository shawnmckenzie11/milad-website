/**
 * Shared site identity and external links for layouts and pages.
 */
export const site = {
	name: 'Dr. Nadia Milad',
	labName: 'Milad Lab',
	shortName: 'Nadia Milad',
	affiliation: 'University of Ottawa',
	email: 'miladn1@mcmaster.ca',
	/**
	 * Destination for Work With Us form mail. Temporary test inbox — change this
	 * single value when the lab mailbox is ready. Keep wrangler `send_email`
	 * `destination_address` in sync if that binding is restricted.
	 */
	joinInbox: 'seashell611@anglernook.com',
	/**
	 * From address for automated join-form mail. Must be a domain onboarded
	 * for Cloudflare Email Sending (or Email Routing, if that binding is used).
	 */
	joinFromEmail: 'join@mckenzian.com',
	/** Worker endpoint that accepts join-form POSTs. */
	joinApiPath: '/api/join',
	researchFocus: 'Cannabis research and evidence synthesis',
	tagline:
		'Building rigorous, open tools and scholarship at the intersection of cannabis science and public health.',
	/** Stylized lung illustration on the homepage hero. */
	lungLogo: '/images/lung-logo.jpg',
	/** Portrait shown beside the homepage biography. */
	headshot: '/images/nadia-milad-headshot.jpg',
	/** MILAB wordmark asset, retained for a later nav/homepage restore. */
	logo: '/images/milad-lab-logo.png',
	/** Ottawa skyline asset, retained for a later homepage restore. */
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
