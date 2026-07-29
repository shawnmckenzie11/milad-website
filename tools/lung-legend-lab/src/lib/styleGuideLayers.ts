import type { StyleGuideProfileBrief } from '../types';

/** Built-in image pathway layers (exposure / composite layers — not legend codes). */
export const DEFAULT_IMAGE_PATHWAYS: PathwayLayer[] = [
	{ id: 'base', label: 'base (all pathways)' },
	{ id: 'cannabis', label: 'cannabis' },
	{ id: 'cigarette-smoke', label: 'cigarette smoke' },
	{ id: 'vaping', label: 'vaping' },
	{ id: 'general-air', label: 'general air' },
	{ id: 'viruses', label: 'viruses' },
];

/**
 * One image pathway layer (composite exposure layer), not a legend glyph (A1/B3…).
 * Legend items are assigned into one or more of these layers.
 */
export type PathwayLayer = {
	id: string;
	label: string;
};

/**
 * Image pathway layers from the style-guide profile (`imagePathways`).
 * Falls back to the built-in base / cannabis / cigarette smoke / … list.
 * @param profile - Active style-guide brief
 */
export function pathwayLayersFromProfile(
	profile: StyleGuideProfileBrief | null | undefined,
): PathwayLayer[] {
	const fromProfile = profile?.imagePathways;
	if (Array.isArray(fromProfile) && fromProfile.length > 0) {
		return fromProfile.map((row) => ({
			id: row.id,
			label: row.label || row.id,
		}));
	}
	return DEFAULT_IMAGE_PATHWAYS.map((row) => ({ ...row }));
}

/**
 * Normalize a pathway label/id for fuzzy matching against legend supports text.
 * @param value - Pathway id or label
 */
function pathwayMatchKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/\s*\(.*?\)\s*/g, ' ')
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Infer image-pathway ids from legend OCR “supports” text, constrained to
 * pathway options present in the profile (or defaults).
 * @param supports - Text under the legend icon (e.g. "cigarette smoke")
 * @param layers - Profile image pathway options
 */
export function pathwaysFromSupports(
	supports: string | null | undefined,
	layers: PathwayLayer[] = DEFAULT_IMAGE_PATHWAYS,
): string[] {
	const s = pathwayMatchKey(supports || '');
	if (!s || layers.length === 0) return [];

	const matched: string[] = [];
	for (const layer of layers) {
		const idKey = pathwayMatchKey(layer.id);
		const labelKey = pathwayMatchKey(layer.label || '');
		const shortLabel = labelKey.replace(/\ball pathways\b/g, '').trim();

		if (layer.id === 'base') {
			if (
				s.includes('all pathway') ||
				s.includes('base anatomy') ||
				s === 'base' ||
				(shortLabel && s.includes(shortLabel) && s.includes('base'))
			) {
				matched.push(layer.id);
			}
			continue;
		}

		if (shortLabel && shortLabel.length >= 3 && s.includes(shortLabel)) {
			matched.push(layer.id);
			continue;
		}
		if (labelKey && labelKey.length >= 3 && s.includes(labelKey)) {
			matched.push(layer.id);
			continue;
		}
		if (idKey && s.includes(idKey)) {
			matched.push(layer.id);
		}
	}
	return [...new Set(matched)];
}

/**
 * Pathway ids listed on a style-guide legend slug row for a legend code.
 * @param code - Legend code (A1–B9)
 * @param profile - Active style-guide brief
 */
export function pathwaysFromStyleGuideSlug(
	code: string,
	profile: StyleGuideProfileBrief | null | undefined,
): string[] {
	const row = profile?.layerNaming?.stableIds?.find((s) => s.legendCode === code);
	if (!row?.pathways?.length) return [];
	const allowed = new Set(pathwayLayersFromProfile(profile).map((l) => l.id));
	return row.pathways.filter((id) => allowed.has(id));
}

/**
 * Normalize stored pathway assignment (string | string[] | null) to an id list.
 * Falls back to style-guide slug pathways, then legend supports text.
 * @param assigned - Classification field(s)
 * @param supports - Optional legend supports text for defaults
 * @param opts - Optional style-guide defaults
 */
export function effectivePathwayIds(
	assigned: string | string[] | null | undefined,
	supports?: string | null,
	opts?: {
		code?: string;
		profile?: StyleGuideProfileBrief | null;
	},
): string[] {
	if (Array.isArray(assigned) && assigned.length > 0) {
		return [...new Set(assigned.map(String).filter(Boolean))];
	}
	if (typeof assigned === 'string' && assigned.trim()) {
		return [assigned.trim()];
	}
	const layers = pathwayLayersFromProfile(opts?.profile);
	if (opts?.code) {
		const fromSlug = pathwaysFromStyleGuideSlug(opts.code, opts.profile);
		if (fromSlug.length) return fromSlug;
	}
	return pathwaysFromSupports(supports, layers);
}

/**
 * Default image-pathway ids when freehand-classifying an existing legend code.
 * Uses classification assignedPathways, then style-guide slug pathways, then
 * supports ∩ catalog; always constrained to `pathwayLayers`.
 * @param item - Legend row when classifying an existing code
 * @param pathwayLayers - Profile pathway catalog
 * @param profile - Active style-guide brief (slug pathway fallback)
 */
export function pathwaysForLegendItem(
	item: { code: string; assignedPathways?: string[] | null; assignedPathway?: string | null; supports?: string | null } | undefined,
	pathwayLayers: PathwayLayer[],
	profile?: StyleGuideProfileBrief | null,
): string[] {
	const allowed = new Set(pathwayLayers.map((l) => l.id));
	if (item) {
		const fromItem = effectivePathwayIds(
			item.assignedPathways ?? item.assignedPathway,
			item.supports,
			{ code: item.code, profile: profile ?? null },
		).filter((id) => allowed.has(id));
		if (fromItem.length > 0) return fromItem;
	}
	if (allowed.has('base')) return ['base'];
	return pathwayLayers[0] ? [pathwayLayers[0].id] : [];
}

/**
 * Whether a legend item should appear for the current View layers selection.
 * Items on `base` appear in every pathway view (base = all pathways).
 * @param itemPathways - Pathways assigned to the legend item
 * @param viewPathwayIds - Active view multi-select (empty = show all)
 */
export function itemVisibleForPathwayView(
	itemPathways: string[],
	viewPathwayIds: string[],
): boolean {
	if (viewPathwayIds.length === 0) return true;
	const set = new Set(itemPathways);
	if (set.has('base')) return true;
	return viewPathwayIds.some((id) => set.has(id));
}

/**
 * Short label list for tooltips / hit labels.
 * @param pathwayIds - Assigned pathway ids
 * @param layers - Catalog of image pathway layers
 */
export function pathwayLabels(
	pathwayIds: string[],
	layers: PathwayLayer[],
): string {
	if (pathwayIds.length === 0) return 'unassigned';
	return pathwayIds
		.map((id) => layers.find((l) => l.id === id)?.label || id)
		.join(', ');
}
