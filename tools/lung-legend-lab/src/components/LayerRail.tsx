import type { LegendItemRow } from '../types';

/** Codes emphasized for adjacent-neighbour similarity (tier-2) training. */
const TIER2_FOCUS_CODES = new Set(['A1', 'B1', 'B6', 'B7']);

type Props = {
	items: LegendItemRow[];
	layerFilter: string;
	onLayerChange: (value: string) => void;
	pathwayFilter: string;
	onPathwayChange: (value: string) => void;
	pathways: string[];
};

/**
 * Whether the current layer focus is a tier-2 adjacent-neighbour training target.
 * @param layerFilter - Active layer chip / select value
 * @param items - Legend rows with tier metadata
 */
function isTier2Focus(layerFilter: string, items: LegendItemRow[]): boolean {
	if (layerFilter === 'all') return false;
	if (TIER2_FOCUS_CODES.has(layerFilter)) return true;
	const row = items.find((i) => i.code === layerFilter);
	return row?.tier === 2;
}

/**
 * Compact layer / pathway filters for the refine dashboard viewer.
 */
export function LayerRail({
	items,
	layerFilter,
	onLayerChange,
	pathwayFilter,
	onPathwayChange,
	pathways,
}: Props) {
	const withHits = items.filter((i) => (i.instanceCount || 0) > 0 || (i.instances?.length ?? 0) > 0);
	const showTier2Banner = isTier2Focus(layerFilter, items);

	return (
		<div className="layer-rail-wrap">
			<div className="layer-rail">
				<label>
					Layer{' '}
					<select value={layerFilter} onChange={(e) => onLayerChange(e.target.value)}>
						<option value="all">all layers</option>
						{items.map((it) => (
							<option key={it.code} value={it.code}>
								{it.code} {it.name.slice(0, 28)}
								{(it.instanceCount || it.instances?.length || 0) > 0
									? ` · ${it.instanceCount || it.instances.length} hit(s)`
									: ''}
							</option>
						))}
					</select>
				</label>
				<label>
					Pathway{' '}
					<select value={pathwayFilter} onChange={(e) => onPathwayChange(e.target.value)}>
						<option value="all">all pathways</option>
						{pathways
							.filter((p) => p !== 'all')
							.map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
					</select>
				</label>
				<div className="layer-chips">
					<button
						type="button"
						className={layerFilter === 'all' ? 'chip active' : 'chip'}
						onClick={() => onLayerChange('all')}
					>
						All
					</button>
					{withHits.map((it) => (
						<button
							key={it.code}
							type="button"
							className={layerFilter === it.code ? 'chip active' : 'chip'}
							onClick={() => onLayerChange(it.code)}
							title={it.name}
						>
							{it.code}
							<span className="muted"> {it.instanceCount || it.instances.length}</span>
						</button>
					))}
				</div>
			</div>
			{showTier2Banner && (
				<div className="tier2-banner" role="status">
					<strong>Tier-2 · adjacent-neighbour similarity</strong>
					<span>
						Relocate, resize, or freehand-trace teach the matcher where similar neighbours
						should land ({layerFilter}
						{TIER2_FOCUS_CODES.has(layerFilter) ? '' : ' · tier 2'}).
					</span>
				</div>
			)}
		</div>
	);
}
