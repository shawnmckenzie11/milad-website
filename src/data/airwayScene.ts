/**
 * Authored spatial model for the inhale-path research map on `/projects`.
 * Coordinates assume the airway-scene.svg canvas (`0 0 1200 800`).
 */

/** SVG viewBox as x, y, width, height in scene units. */
export interface SceneViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Vertical band / role of a node on the causal path. */
export type AirwaySceneLayer =
	| 'person'
	| 'in'
	| 'lung_issue'
	| 'systemic_issue'
	| 'methods';

/** Visual weight: primary (lab-linked) vs muted field context. */
export type AirwaySceneEmphasis = 'primary' | 'context';

/** Interactive region on the inhale-path map. */
export interface AirwaySceneNode {
	/** Stable id matching `data-node-id` in airway-scene.svg. */
	id: string;
	/** Short map label shown in the detail chip when no project link exists. */
	label: string;
	/** One-line scholarly framing for the chip when not overridden by a program. */
	summary: string;
	/** Causal-path band this node belongs to. */
	layer: AirwaySceneLayer;
	/** Linked ProjectCard id on `/projects`, when the hotspot maps to a program. */
	projectId: string | null;
	/** Tight viewBox used when this hotspot is selected. */
	focusViewBox: SceneViewBox;
	/** Whether the node is a primary lab lens or muted field context. */
	emphasis: AirwaySceneEmphasis;
}

/** Directed relationship drawn between two nodes. */
export interface AirwaySceneEdge {
	/** Stable id matching `data-edge-id` in airway-scene.svg. */
	id: string;
	/** Source node id. */
	from: string;
	/** Target node id. */
	to: string;
	/** Relationship label revealed at closer zoom. */
	label: 'enters' | 'leads_to' | 'studies';
}

/** Full authored scene: overview framing plus nodes and edges. */
export interface AirwayScene {
	/** Public path to the layered clinical SVG. */
	svgPath: string;
	/** Full-canvas overview viewBox. */
	overviewViewBox: SceneViewBox;
	/** Interactive nodes (hotspots). */
	nodes: AirwaySceneNode[];
	/** Connecting edges between nodes. */
	edges: AirwaySceneEdge[];
}

/** Default full-scene framing for the inhale-path map. */
export const OVERVIEW_VIEW_BOX: SceneViewBox = {
	x: 0,
	y: 0,
	width: 1200,
	height: 800,
};

/**
 * Serializes a viewBox object to the SVG `viewBox` attribute string.
 * @param viewBox - Scene viewBox in scene units
 */
export function viewBoxToString(viewBox: SceneViewBox): string {
	return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

/**
 * Parses an SVG `viewBox` attribute into a SceneViewBox, or null if invalid.
 * @param value - Raw viewBox attribute string
 */
export function parseViewBox(value: string): SceneViewBox | null {
	const parts = value
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
		return null;
	}
	const [x, y, width, height] = parts;
	return { x, y, width, height };
}

/**
 * Human-readable edge caption for zoomed-in labels (underscores → spaces).
 * @param label - Authored edge label token
 */
export function edgeLabelDisplay(label: AirwaySceneEdge['label']): string {
	if (label === 'leads_to') return 'leads to';
	return label;
}

/** Authored inhale-path map: person → INs → lung issues → elsewhere, with methods overlay. */
export const airwayScene: AirwayScene = {
	svgPath: '/figures/projects/airway-scene.svg',
	overviewViewBox: OVERVIEW_VIEW_BOX,
	nodes: [
		{
			id: 'person-inhale',
			label: 'Person inhaling',
			summary: 'Starting point: inhaled agents enter the airway and can reshape lung and systemic health.',
			layer: 'person',
			projectId: null,
			focusViewBox: { x: 20, y: 120, width: 380, height: 420 },
			emphasis: 'primary',
		},
		{
			id: 'cannabis-smoke',
			label: 'Cannabis smoke',
			summary: 'How cannabis smoke exposure reshapes antiviral immunity and respiratory risk.',
			layer: 'in',
			projectId: 'cannabis-respiratory-health',
			focusViewBox: { x: 200, y: 80, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'cigarette-smoke',
			label: 'Cigarette smoke',
			summary: 'How cigarette smoke disrupts lung immune homeostasis and drives inflammation.',
			layer: 'in',
			projectId: 'smoke-lung-inflammation',
			focusViewBox: { x: 200, y: 220, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'vape-aerosols',
			label: 'Vape aerosols',
			summary: 'Which vaping-liquid constituents drive airway immune and metabolic effects.',
			layer: 'in',
			projectId: 'vaping-toxicology',
			focusViewBox: { x: 200, y: 360, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'viruses',
			label: 'Viruses',
			summary: 'Respiratory viruses are common inhaled challenges; lab programs study how exposures alter antiviral defense.',
			layer: 'in',
			projectId: null,
			focusViewBox: { x: 240, y: 40, width: 320, height: 280 },
			emphasis: 'context',
		},
		{
			id: 'bacteria',
			label: 'Bacteria',
			summary: 'Airborne bacteria and related insults sit in the same inhaled-path context as smoke and aerosols.',
			layer: 'in',
			projectId: null,
			focusViewBox: { x: 240, y: 480, width: 320, height: 280 },
			emphasis: 'context',
		},
		{
			id: 'other-airborne',
			label: 'Other airborne',
			summary: 'Broader airborne exposures (pollutants, occupational dusts) share the inhale → lung → body path.',
			layer: 'in',
			projectId: null,
			focusViewBox: { x: 260, y: 520, width: 320, height: 260 },
			emphasis: 'context',
		},
		{
			id: 'antiviral-impairment',
			label: 'Antiviral impairment',
			summary: 'Impaired antiviral defense in the lung after cannabis and related inhaled exposures.',
			layer: 'lung_issue',
			projectId: 'cannabis-respiratory-health',
			focusViewBox: { x: 480, y: 60, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'neutrophilic-inflammation',
			label: 'Neutrophilic inflammation',
			summary: 'Smoke-driven neutrophilic inflammation and loss of immune balance in the airway.',
			layer: 'lung_issue',
			projectId: 'smoke-lung-inflammation',
			focusViewBox: { x: 480, y: 240, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'epithelial-disruption',
			label: 'Epithelial disruption',
			summary: 'Epithelial and surfactant disruption from smoke and vape exposures; studied with open airway methods.',
			layer: 'lung_issue',
			projectId: 'airway-methods',
			focusViewBox: { x: 480, y: 400, width: 360, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'metabolic-hepatic',
			label: 'Metabolic / hepatic',
			summary: 'Downstream metabolic and hepatic effects linked to vaping chemistry and systemic burden.',
			layer: 'systemic_issue',
			projectId: 'vaping-toxicology',
			focusViewBox: { x: 780, y: 80, width: 380, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'vascular-muscle',
			label: 'Vascular–muscle',
			summary: 'Neuromuscular and vascular consequences beyond the primary airway insult.',
			layer: 'systemic_issue',
			projectId: 'neuromuscular-vascular',
			focusViewBox: { x: 780, y: 260, width: 380, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'clinical-outcomes',
			label: 'Clinical outcomes',
			summary: 'Clinical respiratory outcomes that can follow lung injury, inflammation, and impaired host defense.',
			layer: 'systemic_issue',
			projectId: null,
			focusViewBox: { x: 780, y: 420, width: 380, height: 320 },
			emphasis: 'primary',
		},
		{
			id: 'airway-methods',
			label: 'Airway methods',
			summary: 'Open tools that make human airway exposure studies more rigorous and shareable.',
			layer: 'methods',
			projectId: 'airway-methods',
			focusViewBox: { x: 320, y: 560, width: 560, height: 240 },
			emphasis: 'primary',
		},
	],
	edges: [
		{ id: 'cannabis-antiviral', from: 'cannabis-smoke', to: 'antiviral-impairment', label: 'enters' },
		{ id: 'cannabis-epithelial', from: 'cannabis-smoke', to: 'epithelial-disruption', label: 'enters' },
		{ id: 'cigarette-neutrophil', from: 'cigarette-smoke', to: 'neutrophilic-inflammation', label: 'enters' },
		{ id: 'cigarette-epithelial', from: 'cigarette-smoke', to: 'epithelial-disruption', label: 'enters' },
		{ id: 'vape-epithelial', from: 'vape-aerosols', to: 'epithelial-disruption', label: 'enters' },
		{ id: 'viruses-antiviral', from: 'viruses', to: 'antiviral-impairment', label: 'enters' },
		{ id: 'bacteria-neutrophil', from: 'bacteria', to: 'neutrophilic-inflammation', label: 'enters' },
		{ id: 'other-epithelial', from: 'other-airborne', to: 'epithelial-disruption', label: 'enters' },
		{ id: 'antiviral-clinical', from: 'antiviral-impairment', to: 'clinical-outcomes', label: 'leads_to' },
		{ id: 'neutrophil-clinical', from: 'neutrophilic-inflammation', to: 'clinical-outcomes', label: 'leads_to' },
		{ id: 'epithelial-metabolic', from: 'epithelial-disruption', to: 'metabolic-hepatic', label: 'leads_to' },
		{ id: 'neutrophil-vascular', from: 'neutrophilic-inflammation', to: 'vascular-muscle', label: 'leads_to' },
		{ id: 'methods-cannabis', from: 'airway-methods', to: 'cannabis-smoke', label: 'studies' },
		{ id: 'methods-cigarette', from: 'airway-methods', to: 'cigarette-smoke', label: 'studies' },
		{ id: 'methods-vape', from: 'airway-methods', to: 'vape-aerosols', label: 'studies' },
		{ id: 'methods-epithelial', from: 'airway-methods', to: 'epithelial-disruption', label: 'studies' },
		{ id: 'methods-neutrophil', from: 'airway-methods', to: 'neutrophilic-inflammation', label: 'studies' },
	],
};

/**
 * Looks up a scene node by id.
 * @param id - Node id from airwayScene.nodes
 */
export function getSceneNode(id: string): AirwaySceneNode | undefined {
	return airwayScene.nodes.find((node) => node.id === id);
}

/**
 * Returns edge ids connected to the given node (as source or target).
 * @param nodeId - Node id to inspect
 */
export function getConnectedEdgeIds(nodeId: string): string[] {
	return airwayScene.edges
		.filter((edge) => edge.from === nodeId || edge.to === nodeId)
		.map((edge) => edge.id);
}

/**
 * Returns whether a node is muted field context (no false program CTA).
 * @param nodeId - Scene node id
 */
export function isContextNode(nodeId: string): boolean {
	return getSceneNode(nodeId)?.emphasis === 'context';
}
