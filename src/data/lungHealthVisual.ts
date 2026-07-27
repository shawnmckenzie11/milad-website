/**
 * Phase 0/1 content for the interactive lung-health visualization.
 * Captions and pathway metadata are evidence-bound to /projects programs.
 * Do not invent biology beyond this file.
 */

/** Stable pathway ids used by the visualization and future highlight layers. */
export type LungHealthPathwayId =
	| 'cannabis'
	| 'cigarette'
	| 'air'
	| 'vaping'
	| 'viruses';

/** Where the visualization mounts for the current review phase. */
export interface LungHealthPlacement {
	/** Site route that hosts the visualization. */
	route: '/visualization' | '/projects';
	/** Position relative to page sections when mounted on Projects. */
	anchor: 'above-program-cards' | 'page';
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

/** Percentage-based bubble hotspot over the outdoor scene image. */
export interface LungHealthHotspotLayout {
	/** Pathway this bubble activates. */
	id: LungHealthPathwayId;
	/** Bubble center x as % of image width. */
	x: number;
	/** Bubble center y as % of image height. */
	y: number;
	/** Bubble diameter as % of image width. */
	size: number;
}

/** Outdoor scene asset and interactive bubble layout for Phase 1. */
export interface LungHealthScene {
	/** Public path to the authored Ottawa outdoor scene. */
	imageSrc: string;
	/** Accessible description of the scene image. */
	imageAlt: string;
	/** Clickable/keyboard bubbles aligned to artwork callouts. */
	hotspots: LungHealthHotspotLayout[];
}

/** Structured content for the lung-health visualization. */
export interface LungHealthVisualContent {
	/** Current build phase reflected by shipped UI. */
	phase: 1;
	/** Approved placement on the live site. */
	placement: LungHealthPlacement;
	/** Scene framing for the outdoor Ottawa intake (Phase 1+). */
	sceneSummary: string;
	/** Outdoor scene image + bubble hotspot layout. */
	scene: LungHealthScene;
	/** Locked pathways in display order. */
	pathways: LungHealthPathway[];
	/**
	 * Approaches pulled from lab presentation metadata for Phase 4 methods layer.
	 * Routed through the shared cutaway — not a separate lab scene.
	 */
	methodsForLaterPhases: string[];
}

/**
 * Locked pathway content with Phase 1 review placement on `/visualization`.
 * Public UI must not surface maintainer notes, ORCID, or sync mechanics.
 */
export const lungHealthVisual: LungHealthVisualContent = {
	phase: 1,
	placement: {
		route: '/visualization',
		anchor: 'page',
	},
	sceneSummary:
		'A person stands outdoors in Ottawa. Five exposure pathways lead into one shared schematic lung/airway cutaway.',
	scene: {
		imageSrc: '/images/initial-scene.png',
		imageAlt:
			'Person overlooking Parliament Hill in Ottawa in autumn, with five circular exposure callouts for cannabis, cigarette smoke, vaping, air pollution, and viruses.',
		// Percent positions tuned to the bubble callouts in initial-scene.png.
		hotspots: [
			{ id: 'cannabis', x: 16.5, y: 24, size: 15.5 },
			{ id: 'cigarette', x: 15.5, y: 78, size: 15.5 },
			{ id: 'vaping', x: 58, y: 16, size: 15.5 },
			{ id: 'air', x: 86.5, y: 20, size: 15.5 },
			{ id: 'viruses', x: 83.5, y: 78.5, size: 15.5 },
		],
	},
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
