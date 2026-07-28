/**
 * Canonical layer registry for the shared lung-health cutaway.
 * Observability tiers drive search order and which structures are attempted.
 * Masked/outline PNGs are produced by the OpenCV template-match pipeline
 * (scripts/lung_template_match.py via npm run lung:generate).
 */

import type { LungHealthPathwayId } from './lungHealthVisual';

/** Stable id for a cutaway layer. */
export type LungHealthLayerSlug =
	| 'trachea-conducting-airway'
	| 'bronchial-branches'
	| 'alveolar-fields'
	| 'airway-lumen'
	| 'airway-epithelium'
	| 'airway-immune-compartment'
	| 'neutrophils'
	| 'alveolar-macrophages'
	| 'dendritic-cells'
	| 'antiviral-immune-mediators'
	| 'inflammatory-signaling'
	| 'copd-inflammatory-structures'
	| 'infection-antiviral-pathway';

/** Whether a layer is always-visible anatomy or a pathway highlight. */
export type LungHealthLayerGroup = 'base' | 'highlight';

/**
 * Legend observability tier for mask search.
 * 1 = high-confidence replicas; 2 = present with partial similarity;
 * 3 = hard / scale-divergent; 0 = do not search (absent or not diagrammed).
 */
export type LungHealthObservabilityTier = 0 | 1 | 2 | 3;

/** One registered cutaway layer. */
export interface LungHealthLayerDefinition {
	/** Stable slug matching asset filenames. */
	slug: LungHealthLayerSlug;
	/** Legend code (A1–A4, B1–B9). */
	legendCode: string;
	/** Human-readable structure label (matches legend template). */
	label: string;
	/** Base anatomy vs pathway-highlightable research structure. */
	group: LungHealthLayerGroup;
	/** Observability tier for segmentation search priority. */
	observabilityTier: LungHealthObservabilityTier;
	/** Pathways that illuminate this layer when active. */
	pathways: LungHealthPathwayId[];
}

/** Maps legacy highlightTargets strings from lungHealthVisual.ts to layer slugs. */
export const highlightTargetToSlug: Record<string, LungHealthLayerSlug> = {
	'airway epithelium': 'airway-epithelium',
	'antiviral immune mediators': 'antiviral-immune-mediators',
	neutrophils: 'neutrophils',
	'alveolar macrophages': 'alveolar-macrophages',
	'inflammatory signaling': 'inflammatory-signaling',
	'COPD-relevant inflammatory structures': 'copd-inflammatory-structures',
	'dendritic cells': 'dendritic-cells',
	'airway immune compartment': 'airway-immune-compartment',
	'infection / antiviral pathway': 'infection-antiviral-pathway',
};

/**
 * Pathway → highlight layer slugs.
 * Omits tier-0 structures (A4 lumen, B2 immune compartment, B8 COPD — not searchable).
 */
export const pathwayHighlightSlugs: Record<LungHealthPathwayId, LungHealthLayerSlug[]> = {
	cannabis: ['airway-epithelium', 'antiviral-immune-mediators'],
	cigarette: ['neutrophils', 'alveolar-macrophages', 'inflammatory-signaling'],
	air: [],
	vaping: ['dendritic-cells'],
	viruses: ['infection-antiviral-pathway'],
};

/** Visual accent per pathway for highlight strokes. */
export const pathwayHighlightStyle: Record<
	LungHealthPathwayId,
	{ stroke: string; glow: string }
> = {
	cannabis: { stroke: '#2f8f4e', glow: 'rgba(47, 143, 78, 0.55)' },
	cigarette: { stroke: '#d45a1a', glow: 'rgba(212, 90, 26, 0.55)' },
	air: { stroke: '#2f6f9a', glow: 'rgba(47, 111, 154, 0.55)' },
	vaping: { stroke: '#7a3dba', glow: 'rgba(122, 61, 186, 0.55)' },
	viruses: { stroke: '#1f6fbf', glow: 'rgba(31, 111, 191, 0.55)' },
};

/** Opacity for inactive highlight layers (fully hidden). */
export const INACTIVE_HIGHLIGHT_OPACITY = 0;

/**
 * Outline stroke thickness in source pixels (~20× prior 2px stroke for visibility).
 * Generator dilates masks by half this width to form the outer ring.
 */
export const HIGHLIGHT_OUTLINE_STROKE_PX = 24;

/** High-visibility outline fill used in generated outline PNGs. */
export const HIGHLIGHT_OUTLINE_COLOR = {
	r: 255,
	g: 214,
	b: 10,
	a: 255,
} as const;

/** All layers with legend codes and observability tiers. */
export const lungHealthLayers: LungHealthLayerDefinition[] = [
	{
		slug: 'trachea-conducting-airway',
		legendCode: 'A1',
		label: 'Trachea / conducting airway',
		group: 'base',
		observabilityTier: 2,
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
	},
	{
		slug: 'bronchial-branches',
		legendCode: 'A2',
		label: 'Bronchial branches',
		group: 'base',
		observabilityTier: 3,
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
	},
	{
		slug: 'alveolar-fields',
		legendCode: 'A3',
		label: 'Alveolar fields',
		group: 'base',
		observabilityTier: 3,
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
	},
	{
		slug: 'airway-lumen',
		legendCode: 'A4',
		label: 'Airway lumen',
		group: 'base',
		observabilityTier: 0,
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
	},
	{
		slug: 'airway-epithelium',
		legendCode: 'B1',
		label: 'Airway epithelium',
		group: 'highlight',
		observabilityTier: 2,
		pathways: ['cannabis'],
	},
	{
		slug: 'airway-immune-compartment',
		legendCode: 'B2',
		label: 'Airway immune compartment',
		group: 'highlight',
		observabilityTier: 0,
		pathways: ['vaping'],
	},
	{
		slug: 'neutrophils',
		legendCode: 'B3',
		label: 'Neutrophils',
		group: 'highlight',
		observabilityTier: 1,
		pathways: ['cigarette'],
	},
	{
		slug: 'alveolar-macrophages',
		legendCode: 'B4',
		label: 'Alveolar macrophages',
		group: 'highlight',
		observabilityTier: 1,
		pathways: ['cigarette'],
	},
	{
		slug: 'dendritic-cells',
		legendCode: 'B5',
		label: 'Dendritic cells',
		group: 'highlight',
		observabilityTier: 1,
		pathways: ['vaping'],
	},
	{
		slug: 'antiviral-immune-mediators',
		legendCode: 'B6',
		label: 'Antiviral immune mediators',
		group: 'highlight',
		observabilityTier: 2,
		pathways: ['cannabis'],
	},
	{
		slug: 'inflammatory-signaling',
		legendCode: 'B7',
		label: 'Inflammatory signaling',
		group: 'highlight',
		observabilityTier: 2,
		pathways: ['cigarette'],
	},
	{
		slug: 'copd-inflammatory-structures',
		legendCode: 'B8',
		label: 'COPD-relevant inflammatory structures',
		group: 'highlight',
		observabilityTier: 0,
		pathways: ['air'],
	},
	{
		slug: 'infection-antiviral-pathway',
		legendCode: 'B9',
		label: 'Infection / antiviral pathway',
		group: 'highlight',
		observabilityTier: 1,
		pathways: ['viruses'],
	},
];

/** Layers that may be searched / segmented (tier > 0). */
export const lungHealthSearchableLayers = lungHealthLayers.filter(
	(layer) => layer.observabilityTier > 0,
);

/** Searchable layers sorted tier-1 first. */
export const lungHealthLayersBySearchPriority = [...lungHealthSearchableLayers].sort(
	(a, b) => a.observabilityTier - b.observabilityTier,
);

/** Base anatomy slugs (always shown via full PNG; not toggled). */
export const lungHealthBaseLayerSlugs = lungHealthLayers
	.filter((layer) => layer.group === 'base')
	.map((layer) => layer.slug);

/** Highlight slugs that are searchable and pathway-toggled. */
export const lungHealthHighlightLayerSlugs = lungHealthLayers
	.filter((layer) => layer.group === 'highlight' && layer.observabilityTier > 0)
	.map((layer) => layer.slug);

/**
 * Returns highlight layer slugs for a pathway, or an empty set when idle.
 * @param pathwayId - Active pathway id, or null when no pathway is selected
 */
export function getActiveHighlightSlugs(
	pathwayId: LungHealthPathwayId | null,
): Set<LungHealthLayerSlug> {
	if (!pathwayId) return new Set();
	return new Set(pathwayHighlightSlugs[pathwayId]);
}

/**
 * Resolves opacity for a layer given the active pathway.
 * @param slug - Layer slug
 * @param activePathwayId - Currently selected pathway, or null
 */
export function getLayerOpacity(
	slug: LungHealthLayerSlug,
	activePathwayId: LungHealthPathwayId | null,
): number {
	const layer = lungHealthLayers.find((entry) => entry.slug === slug);
	if (!layer || layer.group === 'base') return 1;
	if (layer.observabilityTier === 0) return 0;
	const active = getActiveHighlightSlugs(activePathwayId);
	return active.has(slug) ? 1 : INACTIVE_HIGHLIGHT_OPACITY;
}
