/**
 * Phase 0–2 content for the interactive lung-health visualization.
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
	/** Program title shown on hotspot hover. */
	previewTitle: string;
	/** Program question shown on hotspot hover. */
	previewQuestion: string;
	/** Hover CTA under the preview copy. */
	previewCta: string;
	/** Plain, evidence-bound caption shown after the pathway is opened. */
	caption: string;
	/** Primary project id from `projects.json` for scroll/focus. */
	projectId: string;
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

/** Percentage point on the outdoor scene used as the zoom camera target. */
export interface LungHealthFocusPoint {
	/** X as % of scene width. */
	x: number;
	/** Y as % of scene height. */
	y: number;
}

/** Outdoor scene asset and interactive bubble layout. */
export interface LungHealthScene {
	/** Public path to the authored Ottawa outdoor scene. */
	imageSrc: string;
	/** Accessible description of the scene image. */
	imageAlt: string;
	/**
	 * Zoom target on the outdoor scene: the subject’s head / nose region.
	 * All pathway selections camera along an arc into this point before the cutaway reveals.
	 */
	subjectZoomFocus: LungHealthFocusPoint;
	/** Clickable/keyboard bubbles aligned to artwork callouts. */
	hotspots: LungHealthHotspotLayout[];
}

/** Shared schematic cutaway revealed after the outdoor zoom. */
export interface LungHealthCutawayAsset {
	/** Public path to the notes-free cutaway artwork. */
	imageSrc: string;
	/** Accessible description of the cutaway. */
	imageAlt: string;
	/** Intrinsic pixel width. */
	width: number;
	/** Intrinsic pixel height. */
	height: number;
}

/** Curved outdoor → cutaway camera path (percent of the outdoor view size). */
export interface LungHealthTransitionArc {
	/** Mid-path horizontal drift (%). Positive shifts the scene left in frame. */
	midX: number;
	/** Mid-path vertical drift (%). Positive shifts the scene up in frame. */
	midY: number;
	/** End-path horizontal drift (%). */
	endX: number;
	/** End-path vertical drift (%). */
	endY: number;
}

/** Motion parameters for the outdoor → cutaway camera (Phase 2). */
export interface LungHealthTransition {
	/** Zoom/crossfade duration in seconds. */
	durationSec: number;
	/** Outdoor scale factor when exiting toward the subject zoom focus. */
	outdoorZoomScale: number;
	/** Arc drifts applied while scaling into the subject’s nose. */
	arc: LungHealthTransitionArc;
	/**
	 * Outdoor stage width/height ratio (stretched scene so callout bubbles read round).
	 */
	outdoorStageAspect: number;
	/**
	 * Cutaway stage height relative to the image’s natural aspect (1.25 = 25% taller).
	 * Stage aspect becomes (cutaway width / height) / cutawayHeightScale.
	 */
	cutawayHeightScale: number;
}

/** Structured content for the lung-health visualization. */
export interface LungHealthVisualContent {
	/** Current build phase reflected by shipped UI. */
	phase: 2;
	/** Approved placement on the live site. */
	placement: LungHealthPlacement;
	/** Scene framing for the outdoor Ottawa intake (Phase 1+). */
	sceneSummary: string;
	/** Outdoor scene image + bubble hotspot layout. */
	scene: LungHealthScene;
	/** Shared lung/airway cutaway asset. */
	cutaway: LungHealthCutawayAsset;
	/** Outdoor → cutaway camera settings. */
	transition: LungHealthTransition;
	/** Locked pathways in display order. */
	pathways: LungHealthPathway[];
	/**
	 * Approaches pulled from lab presentation metadata for Phase 4 methods layer.
	 * Routed through the shared cutaway — not a separate lab scene.
	 */
	methodsForLaterPhases: string[];
}

/**
 * Locked pathway content with Phase 2 placement on `/projects` above program cards.
 * Public UI must not surface maintainer notes, ORCID, or sync mechanics.
 */
export const lungHealthVisual: LungHealthVisualContent = {
	phase: 2,
	placement: {
		route: '/projects',
		anchor: 'above-program-cards',
	},
	sceneSummary:
		'A person stands outdoors in Ottawa. Five exposure pathways lead into one shared schematic lung/airway cutaway.',
	scene: {
		imageSrc: '/images/initial-scene.png',
		imageAlt:
			'Person overlooking Parliament Hill in Ottawa in autumn, with five circular exposure callouts for cannabis, cigarette smoke, vaping, air pollution, and viruses.',
		// Head / nose region of the foreground subject (outdoor scene %).
		// Subject faces into the vista; zoom arcs inward toward the nose.
		subjectZoomFocus: { x: 29, y: 49 },
		// Percent centers measured via on-page calibration against initial-scene.png.
		hotspots: [
			{ id: 'cannabis', x: 18.0, y: 32.6, size: 15 },
			{ id: 'cigarette', x: 12.5, y: 67.4, size: 14 },
			{ id: 'vaping', x: 72.4, y: 18.5, size: 14 },
			{ id: 'air', x: 90.9, y: 26.9, size: 13 },
			{ id: 'viruses', x: 77.5, y: 78.8, size: 14 },
		],
	},
	cutaway: {
		imageSrc: '/figures/lung-health/cutaway-neutral.png',
		imageAlt:
			'Schematic cutaway of the airway and lung, from trachea through bronchi to alveolar regions, with cellular detail insets.',
		width: 1024,
		height: 953,
	},
	transition: {
		// 1.2s zoom into the face + 0.3s hold/fade.
		durationSec: 1.5,
		outdoorZoomScale: 3.15,
		// Curves from a wider framing inward toward the nose.
		arc: {
			midX: 1.8,
			midY: -1.0,
			endX: 6.5,
			endY: -4.0,
		},
		outdoorStageAspect: 1.65,
		cutawayHeightScale: 1.25,
	},
	pathways: [
		{
			id: 'cannabis',
			label: 'Cannabis',
			previewTitle: 'Cannabis exposure and respiratory health',
			previewQuestion:
				'How does cannabis exposure reshape antiviral immunity and respiratory risk?',
			previewCta: 'Click to Explore',
			caption:
				'Cannabis smoke exposure can suppress antiviral immune responses in the lung; related work also examines dried cannabis use, tobacco co-use, and COVID-19 infection in cohort data.',
			projectId: 'cannabis-respiratory-health',
			highlightTargets: ['airway epithelium', 'antiviral immune mediators'],
		},
		{
			id: 'cigarette',
			label: 'Cigarette smoke',
			previewTitle: 'Cigarette smoke, inflammation, and lung homeostasis',
			previewQuestion: 'How do smoke exposures disrupt lung immune homeostasis?',
			previewCta: 'Click to Explore',
			caption:
				'Cigarette smoke disrupts lung immune homeostasis — including neutrophil-driven inflammation and tissue-level signaling linked to airway obstruction and emphysema risk.',
			projectId: 'smoke-lung-inflammation',
			highlightTargets: [
				'neutrophils',
				'alveolar macrophages',
				'inflammatory signaling',
			],
		},
		{
			id: 'air',
			label: 'Airway Exposure',
			previewTitle: 'Open methods for airway exposure studies',
			previewQuestion:
				'Can open tools make human airway exposure studies more rigorous and shareable?',
			previewCta: 'Click to Explore',
			caption:
				'Open airway methods and exposure platforms support more rigorous, shareable human airway studies across the lab’s inhalation programs.',
			projectId: 'airway-methods',
			highlightTargets: ['COPD-relevant inflammatory structures'],
			notes:
				'Bubble art remains the outdoor-air callout; hover/click now route to the Open airway methods program per site direction.',
		},
		{
			id: 'vaping',
			label: 'Vaping',
			previewTitle: 'Vaping product chemistry and airway immunity',
			previewQuestion:
				'Which constituents of vaping liquids drive airway immune and metabolic effects?',
			previewCta: 'Click to Explore',
			caption:
				'Flavor chemicals in vaping products can drive pulmonary dendritic cell maturation; glycerol in vaping liquids affects metabolic readouts in a sex-dependent manner.',
			projectId: 'vaping-toxicology',
			highlightTargets: ['dendritic cells', 'airway immune compartment'],
		},
		{
			id: 'viruses',
			label: 'Viruses',
			previewTitle: 'Cannabis exposure and respiratory health',
			previewQuestion:
				'How does cannabis exposure reshape antiviral immunity and respiratory risk?',
			previewCta: 'Click to Explore',
			caption:
				'Inhaled cannabis smoke can weaken antiviral defenses against influenza A in mice; parallel work tracks respiratory infection risk in observational cohorts.',
			projectId: 'cannabis-respiratory-health',
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

/** Unique program ids shown as full-width tabs under the visualization. */
export const lungHealthTabProjectIds = [
	'cannabis-respiratory-health',
	'vaping-toxicology',
	'smoke-lung-inflammation',
	'airway-methods',
] as const;

/** Custom event name dispatched when a pathway maps to a program tab. */
export const LUNG_HEALTH_SELECT_PROJECT_EVENT = 'lung-health:select-project';

/**
 * Returns the locked pathway definition for a given id.
 * @param id - Pathway id to look up
 */
export function getLungHealthPathway(
	id: LungHealthPathwayId,
): LungHealthPathway | undefined {
	return lungHealthVisual.pathways.find((pathway) => pathway.id === id);
}

/**
 * Returns the cutaway stage width/height ratio from image dimensions and height scale.
 * Matches the artwork aspect so the stage does not leave empty space beside the image.
 * @param cutaway - Shared cutaway asset with intrinsic dimensions
 * @param heightScale - Multiplier applied to stage height (e.g. 1.25 = 25% taller)
 */
export function getCutawayStageAspect(
	cutaway: Pick<LungHealthCutawayAsset, 'width' | 'height'>,
	heightScale: number,
): number {
	return cutaway.width / cutaway.height / heightScale;
}
