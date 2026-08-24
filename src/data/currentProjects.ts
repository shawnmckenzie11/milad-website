/**
 * Current research programs shown on the Projects page.
 * These are authored themes, not derived from the publication sync.
 */

/** A current research program without a publication snapshot. */
export interface CurrentProject {
	/** Stable slug used as the card element id. */
	id: string;
	/** Public program title. */
	title: string;
	/** One-line scientific question. */
	question: string;
	/** Short scholarly description for the card body. */
	summary: string;
}

const CURRENT_PROJECTS: CurrentProject[] = [
	{
		id: 'cannabis-use-development',
		title: 'Cannabis use and development',
		question: 'How does cannabis exposure during development shape lung and systemic health?',
		summary:
			'This program examines developmental windows of cannabis exposure and their consequences for respiratory and systemic outcomes, using cell-based models, animal studies, and clinical data.',
	},
	{
		id: 'cannabis-delivery-methods',
		title: 'Cannabis delivery methods',
		question: 'Do smoke, vapour, and other delivery routes produce distinct biological effects?',
		summary:
			'This program compares cannabis delivery methods—including smoke and vapour—to understand how route of administration influences lung and systemic responses.',
	},
	{
		id: 'cannabis-aging-senescence',
		title: 'Cannabis and aging/senescence',
		question: 'How does cannabis exposure intersect with cellular senescence and aging in the lung?',
		summary:
			'This program investigates links between cannabis exposure, cellular senescence, and age-related changes in lung and systemic health.',
	},
	{
		id: 'cannabis-immunomodulatory-therapy',
		title: 'Cannabis and immunomodulatory therapy',
		question: 'Can cannabis-related exposures inform immunomodulatory strategies in the lung?',
		summary:
			'This program explores cannabis-related inhaled exposures alongside immunomodulatory approaches relevant to lung inflammation and host defense.',
	},
];

/**
 * Returns the current research programs in display order.
 */
export function getCurrentProjects(): CurrentProject[] {
	return CURRENT_PROJECTS;
}
