/**
 * Phase 0 content lock for the interactive lung-health visualization.
 * Captions and pathway metadata are evidence-bound to /projects programs.
 * Interaction UI ships in later phases — do not invent biology beyond this file.
 */

/** Stable pathway ids used by the visualization and future highlight layers. */
export type LungHealthPathwayId =
	| 'cannabis'
	| 'cigarette'
	| 'air'
	| 'vaping'
	| 'viruses';

/** Where the visualization mounts once Phase 1+ UI exists. */
export interface LungHealthPlacement {
	/** Site route that hosts the visualization. */
	route: '/projects';
	/** Position relative to existing Projects page sections. */
	anchor: 'above-program-cards';
}

/** One exposure pathway with evidence-bound caption and program links. */
export interface LungHealthPathway {
	/** Stable id for interaction state and highlight layers. */
	id: LungHealthPathwayId;
	/** Short hotspot / list label. */
	label: string;
	/** Plain, evidence-bound caption shown when the pathway is selected. */
	caption: string;
	/** Project ids from `projects.json` that back this pathway. */
	projectIds: string[];
	/**
	 * Structures intended for Phase 3 highlight layers.
	 * Preview only — not rendered until Phase 3 is approved.
	 */
	highlightTargets: string[];
	/** Content-accuracy notes for maintainers (not public UI copy). */
	notes?: string;
}

/** Structured content for the lung-health visualization. */
export interface LungHealthVisualContent {
	/** Content-lock version for this phased build. */
	phase: 0;
	/** Approved placement on the live site. */
	placement: LungHealthPlacement;
	/** Scene framing for the outdoor Ottawa intake (Phase 1+). */
	sceneSummary: string;
	/** Locked pathways in display order. */
	pathways: LungHealthPathway[];
	/**
	 * Approaches pulled from lab presentation metadata for Phase 4 methods layer.
	 * Routed through the shared cutaway — not a separate lab scene.
	 */
	methodsForLaterPhases: string[];
}

/**
 * Phase 0 locked content: five pathways (bacteria swapped for vaping).
 * Public UI must not surface these notes, ORCID, or sync mechanics.
 */
export const lungHealthVisual: LungHealthVisualContent = {
	phase: 0,
	placement: {
		route: '/projects',
		anchor: 'above-program-cards',
	},
	sceneSummary:
		'A person stands outdoors in Ottawa. Five exposure pathways lead into one shared schematic lung/airway cutaway.',
	pathways: [
		{
			id: 'cannabis',
			label: 'Cannabis',
			caption:
				'Cannabis smoke exposure can suppress antiviral immune responses in the lung; related work also examines dried cannabis use, tobacco co-use, and COVID-19 infection in cohort data.',
			projectIds: ['cannabis-respiratory-health'],
			highlightTargets: ['airway epithelium', 'antiviral immune mediators'],
		},
		{
			id: 'cigarette',
			label: 'Cigarette smoke',
			caption:
				'Cigarette smoke disrupts lung immune homeostasis — including neutrophil-driven inflammation and tissue-level signaling linked to airway obstruction and emphysema risk.',
			projectIds: ['smoke-lung-inflammation'],
			highlightTargets: [
				'neutrophils',
				'alveolar macrophages',
				'inflammatory signaling',
			],
		},
		{
			id: 'air',
			label: 'General air',
			caption:
				'Particulate and smoke-related airway stress connect to COPD-relevant lung inflammation and obstruction biology studied in preclinical and tissue models.',
			projectIds: ['smoke-lung-inflammation', 'other-recent'],
			highlightTargets: ['COPD-relevant inflammatory structures'],
			notes:
				'Softest conceptual fit: site evidence is smoke/COPD/airway obstruction, not a dedicated ambient-particulate program. Outdoor air is the intake metaphor.',
		},
		{
			id: 'vaping',
			label: 'Vaping',
			caption:
				'Flavor chemicals in vaping products can drive pulmonary dendritic cell maturation; glycerol in vaping liquids affects metabolic readouts in a sex-dependent manner.',
			projectIds: ['vaping-toxicology'],
			highlightTargets: ['dendritic cells', 'airway immune compartment'],
		},
		{
			id: 'viruses',
			label: 'Viruses',
			caption:
				'Inhaled cannabis smoke can weaken antiviral defenses against influenza A in mice; parallel work tracks respiratory infection risk in observational cohorts.',
			projectIds: ['cannabis-respiratory-health'],
			highlightTargets: ['infection / antiviral pathway'],
			notes:
				'Overlaps cannabis primary papers. Phase 3 highlights should differentiate exposure/immune suppression (cannabis) vs infection/antiviral pathway (viruses) without inventing cell types.',
		},
	],
	methodsForLaterPhases: [
		'Murine infection models',
		'Longitudinal cohorts',
		'Aerosol exposures',
		'Pulmonary immunology',
		'Preclinical smoke models',
		'Tissue transcriptomics',
		'Immune phenotyping',
		'Air–liquid interface culture',
	],
};

/**
 * Returns the locked pathway definition for a given id.
 * @param id - Pathway id to look up
 */
export function getLungHealthPathway(
	id: LungHealthPathwayId,
): LungHealthPathway | undefined {
	return lungHealthVisual.pathways.find((pathway) => pathway.id === id);
}
