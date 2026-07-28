/**
 * Lung cutaway feature database — coordinate outlines calibrated to
 * `public/figures/lung-health/cutaway-neutral.png` (1024×953).
 *
 * Regions are in image pixel space (origin top-left). Used by the layer
 * generator for masked PNG exports and by the runtime cutaway overlay.
 */

import type { LungHealthLayerSlug } from './lungHealthLayers';
import type { LungHealthPathwayId } from './lungHealthVisual';

/** Closed polygon in image pixel coordinates. */
export type LungHealthPolygon = readonly (readonly [number, number])[];

/** Elliptical region in image pixel coordinates. */
export interface LungHealthEllipseRegion {
	type: 'ellipse';
	cx: number;
	cy: number;
	rx: number;
	ry: number;
}

/** Polygon region in image pixel coordinates. */
export interface LungHealthPolygonRegion {
	type: 'polygon';
	points: LungHealthPolygon;
}

/** Axis-aligned rectangle in image pixel coordinates. */
export interface LungHealthRectRegion {
	type: 'rect';
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One highlightable or structural region outline. */
export type LungHealthRegion =
	| LungHealthPolygonRegion
	| LungHealthEllipseRegion
	| LungHealthRectRegion;

/** Pixel sample used to validate region placement against the source PNG. */
export interface LungHealthValidationSample {
	x: number;
	y: number;
	/** Human-readable note for maintainers (not public UI). */
	note: string;
}

/** One anatomical or research feature in the cutaway. */
export interface LungHealthFeature {
	slug: LungHealthLayerSlug;
	label: string;
	group: 'base' | 'highlight';
	appearance: string;
	location: string;
	pathways: LungHealthPathwayId[];
	/** Primary outline; additional fragments use `regions`. */
	region: LungHealthRegion;
	/** Extra outlines when a feature spans disconnected areas. */
	regions?: LungHealthRegion[];
	/** Samples that must fall inside the outline for image-match QA. */
	validationSamples: LungHealthValidationSample[];
}

/** Authoritative canvas metadata for the neutral cutaway artwork. */
export const lungHealthCanvas = {
	width: 1024,
	height: 953,
	sourceImage: '/figures/lung-health/cutaway-neutral.png',
	legendImage: '/figures/lung-health/Lung Cutaway Legend Template.png',
	entryAnchor: { x: 512, y: 48 },
} as const;

/** Dotted zoom callouts on the main tree (for future camera targets). */
export const lungHealthZoomTargets = [
	{ id: 'trachea-wall', cx: 512, cy: 118, r: 22 },
	{ id: 'left-bronchus', cx: 358, cy: 318, r: 26 },
	{ id: 'right-bronchus', cx: 668, cy: 318, r: 26 },
	{ id: 'left-junction', cx: 228, cy: 548, r: 24 },
	{ id: 'right-junction', cx: 798, cy: 548, r: 24 },
] as const;

/**
 * Canonical feature registry aligned with the Lung Cutaway Legend Template.
 * Coordinates traced against cutaway-neutral.png at native 1024×953 resolution.
 */
export const lungHealthFeatures: LungHealthFeature[] = [
	{
		slug: 'trachea-conducting-airway',
		label: 'Trachea / conducting airway',
		group: 'base',
		appearance: 'Ribbed vertical tube with cartilaginous rings',
		location: 'Top center, upper third',
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
		region: {
			type: 'polygon',
			points: [
				[468, 36],
				[556, 36],
				[562, 208],
				[462, 208],
			],
		},
		validationSamples: [{ x: 512, y: 120, note: 'mid trachea lumen' }],
	},
	{
		slug: 'bronchial-branches',
		label: 'Bronchial branches',
		group: 'base',
		appearance: 'Y-split bronchi and secondary branches',
		location: 'Mid-tree, left and right of centerline',
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
		region: {
			type: 'polygon',
			points: [
				[448, 200],
				[576, 200],
				[620, 280],
				[780, 420],
				[840, 520],
				[720, 560],
				[640, 480],
				[512, 320],
				[384, 480],
				[304, 560],
				[184, 520],
				[244, 420],
				[404, 280],
			],
		},
		validationSamples: [
			{ x: 340, y: 360, note: 'left primary bronchus' },
			{ x: 684, y: 360, note: 'right primary bronchus' },
		],
	},
	{
		slug: 'alveolar-fields',
		label: 'Alveolar fields',
		group: 'base',
		appearance: 'Translucent grape-cluster sacs with capillary mesh',
		location: 'Lower left and lower right clusters',
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
		region: {
			type: 'ellipse',
			cx: 148,
			cy: 748,
			rx: 128,
			ry: 158,
		},
		regions: [
			{
				type: 'ellipse',
				cx: 876,
				cy: 708,
				rx: 132,
				ry: 168,
			},
		],
		validationSamples: [
			{ x: 120, y: 760, note: 'left alveolar cluster' },
			{ x: 900, y: 720, note: 'right alveolar cluster' },
		],
	},
	{
		slug: 'airway-lumen',
		label: 'Airway lumen',
		group: 'base',
		appearance: 'Interior airway cavity and top-right lumen inset',
		location: 'Conducting airways + circular inset callout',
		pathways: ['cannabis', 'cigarette', 'air', 'vaping', 'viruses'],
		region: {
			type: 'ellipse',
			cx: 818,
			cy: 178,
			rx: 148,
			ry: 148,
		},
		regions: [
			{
				type: 'polygon',
				points: [
					[488, 48],
					[536, 48],
					[536, 188],
					[488, 188],
				],
			},
		],
		validationSamples: [{ x: 820, y: 140, note: 'airway lumen inset center' }],
	},
	{
		slug: 'airway-epithelium',
		label: 'Airway epithelium',
		group: 'highlight',
		appearance: 'Ciliated columnar cell row lining the lumen',
		location: 'Inset: airway lumen lining cross-section',
		pathways: ['cannabis'],
		region: {
			type: 'polygon',
			points: [
				[698, 228],
				[938, 228],
				[928, 278],
				[708, 278],
			],
		},
		validationSamples: [{ x: 820, y: 252, note: 'ciliated epithelial band' }],
	},
	{
		slug: 'airway-immune-compartment',
		label: 'Airway immune compartment',
		group: 'highlight',
		appearance: 'Sub-epithelial pink peri-airway tissue band',
		location: 'Below epithelium in lumen inset; peri-bronchial wall',
		pathways: ['vaping'],
		region: {
			type: 'polygon',
			points: [
				[688, 278],
				[948, 278],
				[938, 338],
				[698, 338],
			],
		},
		regions: [
			{
				type: 'polygon',
				points: [
					[318, 380],
					[388, 380],
					[378, 430],
					[308, 430],
				],
			},
			{
				type: 'polygon',
				points: [
					[636, 380],
					[706, 380],
					[696, 430],
					[626, 430],
				],
			},
		],
		validationSamples: [{ x: 820, y: 308, note: 'sub-epithelial pink zone' }],
	},
	{
		slug: 'neutrophils',
		label: 'Neutrophils',
		group: 'highlight',
		appearance: 'Multi-lobed purple nucleus cell',
		location: 'Airway lumen inset; scattered near junction inset',
		pathways: ['cigarette'],
		region: {
			type: 'ellipse',
			cx: 778,
			cy: 302,
			rx: 38,
			ry: 32,
		},
		regions: [
			{
				type: 'ellipse',
				cx: 428,
				cy: 748,
				rx: 28,
				ry: 24,
			},
		],
		validationSamples: [{ x: 778, y: 302, note: 'purple neutrophil inset' }],
	},
	{
		slug: 'alveolar-macrophages',
		label: 'Alveolar macrophages',
		group: 'highlight',
		appearance: 'Round pale-green macrophage with central nucleus',
		location: 'Junction inset; alveolar-adjacent spaces',
		pathways: ['cigarette'],
		region: {
			type: 'ellipse',
			cx: 468,
			cy: 778,
			rx: 34,
			ry: 30,
		},
		regions: [
			{
				type: 'ellipse',
				cx: 548,
				cy: 812,
				rx: 28,
				ry: 26,
			},
		],
		validationSamples: [{ x: 468, y: 778, note: 'green macrophage junction inset' }],
	},
	{
		slug: 'dendritic-cells',
		label: 'Dendritic cells',
		group: 'highlight',
		appearance: 'Star-shaped purple cell with dendrites',
		location: 'Sub-epithelial lumen inset; junction inset',
		pathways: ['vaping'],
		region: {
			type: 'ellipse',
			cx: 862,
			cy: 318,
			rx: 42,
			ry: 38,
		},
		regions: [
			{
				type: 'ellipse',
				cx: 388,
				cy: 728,
				rx: 36,
				ry: 32,
			},
		],
		validationSamples: [{ x: 862, y: 318, note: 'dendritic cell lumen inset' }],
	},
	{
		slug: 'antiviral-immune-mediators',
		label: 'Antiviral immune mediators',
		group: 'highlight',
		appearance: 'Y-shaped antibodies and blue signaling dots near epithelium',
		location: 'Upper lumen inset, above epithelial row',
		pathways: ['cannabis'],
		region: {
			type: 'polygon',
			points: [
				[710, 98],
				[930, 98],
				[920, 218],
				[720, 218],
			],
		},
		validationSamples: [{ x: 820, y: 150, note: 'antibody / mediator field' }],
	},
	{
		slug: 'inflammatory-signaling',
		label: 'Inflammatory signaling',
		group: 'highlight',
		appearance: 'Red dot clusters and directional arrows',
		location: 'Airway–alveolar junction inset',
		pathways: ['cigarette'],
		region: {
			type: 'polygon',
			points: [
				[318, 668],
				[688, 668],
				[678, 848],
				[328, 848],
			],
		},
		validationSamples: [{ x: 508, y: 758, note: 'red signaling arrows junction' }],
	},
	{
		slug: 'copd-inflammatory-structures',
		label: 'COPD-relevant inflammatory structures',
		group: 'highlight',
		appearance: 'Stressed distal airway and alveolar wall morphology',
		location: 'Distal bronchioles and lower central alveolar stress',
		pathways: ['air'],
		region: {
			type: 'polygon',
			points: [
				[420, 488],
				[604, 488],
				[594, 628],
				[430, 628],
			],
		},
		regions: [
			{
				type: 'ellipse',
				cx: 248,
				cy: 588,
				rx: 52,
				ry: 44,
			},
			{
				type: 'ellipse',
				cx: 776,
				cy: 568,
				rx: 52,
				ry: 44,
			},
		],
		validationSamples: [{ x: 512, y: 558, note: 'distal bronchiole stress zone' }],
	},
	{
		slug: 'infection-antiviral-pathway',
		label: 'Infection / antiviral pathway',
		group: 'highlight',
		appearance: 'Spiky blue virus particles and host-response cues',
		location: 'Upper lumen inset; distinct from mediator field',
		pathways: ['viruses'],
		region: {
			type: 'polygon',
			points: [
				[728, 108],
				[868, 108],
				[858, 198],
				[738, 198],
			],
		},
		validationSamples: [{ x: 798, y: 148, note: 'virus particle cluster' }],
	},
];

/**
 * Returns all region outlines for a feature (primary + extras).
 * @param feature - Feature entry from the database
 */
export function getFeatureRegions(feature: LungHealthFeature): LungHealthRegion[] {
	return feature.regions ? [feature.region, ...feature.regions] : [feature.region];
}

/**
 * Converts a region outline to an SVG path `d` attribute string.
 * @param region - Polygon, ellipse, or rect region
 */
export function regionToSvgPath(region: LungHealthRegion): string {
	if (region.type === 'polygon') {
		const [first, ...rest] = region.points;
		if (!first) return '';
		return (
			`M ${first[0]} ${first[1]} ` +
			rest.map(([x, y]) => `L ${x} ${y}`).join(' ') +
			' Z'
		);
	}
	if (region.type === 'rect') {
		return `M ${region.x} ${region.y} h ${region.width} v ${region.height} h ${-region.width} Z`;
	}
	const { cx, cy, rx, ry } = region;
	return (
		`M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} ` +
		`A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
	);
}

/**
 * Returns true when a point lies inside a region outline.
 * @param x - Image x coordinate
 * @param y - Image y coordinate
 * @param region - Region outline
 */
export function pointInRegion(x: number, y: number, region: LungHealthRegion): boolean {
	if (region.type === 'rect') {
		return (
			x >= region.x &&
			x <= region.x + region.width &&
			y >= region.y &&
			y <= region.y + region.height
		);
	}
	if (region.type === 'ellipse') {
		const dx = (x - region.cx) / region.rx;
		const dy = (y - region.cy) / region.ry;
		return dx * dx + dy * dy <= 1;
	}
	// Ray-casting for polygons
	let inside = false;
	const points = region.points;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const xi = points[i][0];
		const yi = points[i][1];
		const xj = points[j][0];
		const yj = points[j][1];
		const intersect =
			yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * Looks up a feature by slug.
 * @param slug - Layer slug
 */
export function getLungHealthFeature(
	slug: LungHealthLayerSlug,
): LungHealthFeature | undefined {
	return lungHealthFeatures.find((feature) => feature.slug === slug);
}
