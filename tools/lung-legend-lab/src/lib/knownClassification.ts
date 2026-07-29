import type { LegendItemRow } from '../types';

/**
 * Owner-known classification defaults for the Milad Lab cutaway legend.
 * Used to prefill Legend View after Tier 1 Complete (Tier-2 assignment pass).
 * Keep in sync with `scripts/lung_legend_observability.py` KNOWN_CLASSIFICATION.
 */
export const KNOWN_CLASSIFICATION: Record<
	string,
	Pick<
		LegendItemRow,
		'tier' | 'subTier' | 'iconInterpretation' | 'searchable' | 'group' | 'slug' | 'note'
	>
> = {
	A1: {
		tier: 2,
		subTier: 'partial-neighbor-similarity',
		iconInterpretation: 'multiple-adjacent-as-one',
		searchable: true,
		group: 'base',
		slug: 'trachea-conducting-airway',
		note: null,
	},
	A2: {
		tier: 3,
		subTier: 'fractal-scale-continuation',
		iconInterpretation: 'multiple-adjacent-as-one',
		searchable: true,
		group: 'base',
		slug: 'bronchial-branches',
		note: null,
	},
	A3: {
		tier: 3,
		subTier: 'scale-divergent-low-similarity',
		iconInterpretation: 'multiple-adjacent-as-one',
		searchable: true,
		group: 'base',
		slug: 'alveolar-fields',
		note: null,
	},
	A4: {
		tier: 0,
		subTier: 'not-diagrammed-in-legend',
		iconInterpretation: '1-discrete',
		searchable: false,
		group: 'base',
		slug: 'airway-lumen',
		note: null,
	},
	B1: {
		tier: 2,
		subTier: 'partial-neighbor-similarity',
		iconInterpretation: 'multiple-adjacent-as-one',
		searchable: true,
		group: 'highlight',
		slug: 'airway-epithelium',
		note: null,
	},
	B2: {
		tier: 0,
		subTier: 'not-diagrammed-in-legend',
		iconInterpretation: '1-discrete',
		searchable: false,
		group: 'highlight',
		slug: 'airway-immune-compartment',
		note: null,
	},
	B3: {
		tier: 1,
		subTier: 'exact-replica',
		iconInterpretation: '1-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'neutrophils',
		note: null,
	},
	B4: {
		tier: 1,
		subTier: 'exact-replica',
		iconInterpretation: '1-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'alveolar-macrophages',
		note: null,
	},
	B5: {
		tier: 1,
		subTier: 'exact-replica',
		iconInterpretation: '1-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'dendritic-cells',
		note: null,
	},
	B6: {
		tier: 2,
		subTier: 'explicitly-present',
		iconInterpretation: '2-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'antiviral-immune-mediators',
		note: null,
	},
	B7: {
		tier: 2,
		subTier: 'explicitly-present',
		iconInterpretation: '1-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'inflammatory-signaling',
		note: null,
	},
	B8: {
		tier: 0,
		subTier: 'absent-from-figure',
		iconInterpretation: '1-discrete',
		searchable: false,
		group: 'highlight',
		slug: 'copd-inflammatory-structures',
		note: 'Exact legend style, but not in the cutaway diagram',
	},
	B9: {
		tier: 1,
		subTier: 'exact-replica',
		iconInterpretation: '1-discrete',
		searchable: true,
		group: 'highlight',
		slug: 'infection-antiviral-pathway',
		note: null,
	},
};

/**
 * Prefill unset (non–Tier-1) rows with known Tier-2 / skip defaults for the
 * Legend View assignment pass. Locked Tier-1 owner picks are preserved.
 * @param items - Current legend rows
 */
export function seedKnownTierAfterTier1(items: LegendItemRow[]): LegendItemRow[] {
	return items.map((it) => {
		if (it.tier === 1) return it;
		const known = KNOWN_CLASSIFICATION[it.code];
		if (!known) return it;
		// Prefill Tier 2 for the assignment pass; leave Tier 3 for a later gate.
		if (known.tier === 2 || known.tier === 0) {
			return {
				...it,
				tier: known.tier,
				subTier: known.subTier,
				iconInterpretation: known.iconInterpretation,
				searchable: known.searchable,
				group: known.group || it.group,
				slug: known.slug || it.slug,
				note: known.note ?? it.note,
			};
		}
		return it;
	});
}

/**
 * Prefill known Tier-3 rows after Mark Tier 2 Complete. Preserves Tier 1–2 picks.
 * @param items - Current legend rows
 */
export function seedKnownTierAfterTier2(items: LegendItemRow[]): LegendItemRow[] {
	return items.map((it) => {
		if (it.tier === 1 || it.tier === 2) return it;
		const known = KNOWN_CLASSIFICATION[it.code];
		if (!known || known.tier !== 3) return it;
		return {
			...it,
			tier: known.tier,
			subTier: known.subTier,
			iconInterpretation: known.iconInterpretation,
			searchable: known.searchable,
			group: known.group || it.group,
			slug: known.slug || it.slug,
			note: known.note ?? it.note,
		};
	});
}
