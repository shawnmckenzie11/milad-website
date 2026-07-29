import { useMemo } from 'react';
import type { LegendItemRow } from '../types';
import { assetUrl } from '../api';
import type { PathwayLayer } from '../lib/styleGuideLayers';

type Props = {
	/** Legend rows for the current Tier to Test. */
	items: LegendItemRow[];
	/** Image pathway layers (base / cannabis / …). */
	pathwayLayers: PathwayLayer[];
	/** Multi-select pathway ids currently visible. Empty = all pathways. */
	viewPathwayIds: string[];
	onViewPathwayIdsChange: (ids: string[]) => void;
	/**
	 * Legend codes visible on the cutaway.
	 * `null` = all for the tier; `[]` = none; otherwise only listed codes.
	 */
	viewCodes: string[] | null;
	onViewCodesChange: (codes: string[] | null) => void;
	/** When true, draw hit / freehand text labels on the cutaway. */
	showLabels?: boolean;
	onShowLabelsChange?: (show: boolean) => void;
	/** Current cutaway zoom scale (1 = fit). */
	zoom: number;
	onZoomChange: (zoom: number) => void;
	/**
	 * When false, omit Zoom − / % / + / Fit (Database View reuses this rail).
	 * @default true
	 */
	showZoom?: boolean;
	/** Cache-bust for glyph assets. */
	bust?: number;
	busy?: boolean;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/**
 * Narrow left rail beside the cutaway: pathway visibility, legend-item
 * visibility toggles (view only — no Assign), and optional zoom controls.
 */
export function ImageViewPanel({
	items,
	pathwayLayers,
	viewPathwayIds,
	onViewPathwayIdsChange,
	viewCodes,
	onViewCodesChange,
	showLabels = true,
	onShowLabelsChange,
	zoom,
	onZoomChange,
	showZoom = true,
	bust = 0,
	busy = false,
}: Props) {
	const viewSet = useMemo(() => new Set(viewPathwayIds), [viewPathwayIds]);
	const codeSet = useMemo(
		() => (viewCodes == null ? null : new Set(viewCodes)),
		[viewCodes],
	);

	/**
	 * Toggle an image pathway layer in the view multi-select.
	 * @param id - Pathway layer id
	 */
	function toggleViewPathway(id: string) {
		if (viewSet.has(id)) {
			onViewPathwayIdsChange(viewPathwayIds.filter((x) => x !== id));
		} else {
			onViewPathwayIdsChange([...viewPathwayIds, id]);
		}
	}

	/**
	 * Select or clear all pathway layers for viewing.
	 * Empty filter = show all pathways (same rule as CutawayViewer).
	 * @param all - When true, select every catalog pathway explicitly
	 */
	function setViewAllPathways(all: boolean) {
		onViewPathwayIdsChange(all ? pathwayLayers.map((l) => l.id) : []);
	}

	/**
	 * Whether a legend code is currently visible on the cutaway.
	 * @param code - Legend code
	 */
	function isCodeVisible(code: string): boolean {
		if (codeSet == null) return true;
		return codeSet.has(code);
	}

	/**
	 * Toggle a legend code in the visibility filter.
	 * @param code - Legend code
	 */
	function toggleViewCode(code: string) {
		if (viewCodes == null) {
			onViewCodesChange(items.map((i) => i.code).filter((c) => c !== code));
			return;
		}
		if (codeSet?.has(code)) {
			onViewCodesChange(viewCodes.filter((c) => c !== code));
		} else {
			const next = [...viewCodes, code];
			onViewCodesChange(next.length >= items.length ? null : next);
		}
	}

	/**
	 * Show every legend item in the current tier.
	 */
	function showAllCodes() {
		onViewCodesChange(null);
	}

	/**
	 * Hide every legend item overlay for the current tier.
	 */
	function hideAllCodes() {
		onViewCodesChange([]);
	}

	/**
	 * Nudge zoom in or out by one step, clamped to min/max.
	 * @param direction - +1 zoom in, −1 zoom out
	 */
	function bumpZoom(direction: 1 | -1) {
		const next = Math.round((zoom + direction * ZOOM_STEP) * 100) / 100;
		onZoomChange(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
	}

	/**
	 * Reset cutaway zoom to fit (1×).
	 */
	function resetZoom() {
		onZoomChange(1);
	}

	return (
		<aside className="image-view-panel" aria-label="Image view layers">
			{onShowLabelsChange && (
				<section className="image-view-panel__section image-view-panel__section--labels">
					<label className="image-view-panel__check image-view-panel__check--labels">
						<input
							type="checkbox"
							checked={showLabels}
							disabled={busy}
							onChange={(e) => onShowLabelsChange(e.target.checked)}
						/>
						<span>Show labels</span>
					</label>
				</section>
			)}

			<section className="image-view-panel__section">
				<h3 className="image-view-panel__title">View layers</h3>
				<p className="muted image-view-panel__hint">
					Pathway layers. Items on base show in every pathway view.
				</p>
				<div className="image-view-panel__actions">
					<button type="button" disabled={busy} onClick={() => setViewAllPathways(true)}>
						All
					</button>
					<button type="button" disabled={busy} onClick={() => setViewAllPathways(false)}>
						None
					</button>
				</div>
				<div
					className="image-view-panel__pathways"
					role="group"
					aria-label="Pathway layers to view"
				>
					{pathwayLayers.map((l) => (
						<label key={l.id} className="image-view-panel__check">
							<input
								type="checkbox"
								checked={viewSet.has(l.id)}
								disabled={busy}
								onChange={() => toggleViewPathway(l.id)}
							/>
							<span title={l.label}>{l.label}</span>
						</label>
					))}
					{pathwayLayers.length === 0 && (
						<p className="muted">No pathways in style guide.</p>
					)}
				</div>
			</section>

			<section className="image-view-panel__section">
				<h3 className="image-view-panel__title">Legend items</h3>
				<p className="muted image-view-panel__hint">
					Toggle visibility on the cutaway. Lists tiers 1…current Tier to Test.
				</p>
				<div className="image-view-panel__actions">
					<button type="button" disabled={busy || items.length === 0} onClick={showAllCodes}>
						All
					</button>
					<button type="button" disabled={busy || items.length === 0} onClick={hideAllCodes}>
						None
					</button>
				</div>
				<div className="image-view-panel__glyphs" role="group" aria-label="Legend items to view">
					{items.map((it) => {
						const on = isCodeVisible(it.code);
						return (
							<button
								key={it.code}
								type="button"
								className={on ? 'chip chip--glyph active' : 'chip chip--glyph'}
								disabled={busy}
								onClick={() => toggleViewCode(it.code)}
								title={`${it.code} · ${it.name}${on ? ' · visible' : ' · hidden'}`}
								aria-label={`${it.code} ${it.name}`}
								aria-pressed={on}
							>
								<img
									className="chip-glyph chip-glyph--rail"
									src={assetUrl(`/api/assets/glyph/${it.code}`, bust)}
									alt=""
									width={36}
									height={36}
									draggable={false}
								/>
								<span className="image-view-panel__code">{it.code}</span>
							</button>
						);
					})}
					{items.length === 0 && <p className="muted">No items in this tier.</p>}
				</div>
			</section>

			{showZoom && (
				<section className="image-view-panel__section">
					<h3 className="image-view-panel__title">Zoom</h3>
					<div className="image-view-panel__zoom" role="group" aria-label="Cutaway zoom">
						<button
							type="button"
							disabled={busy || zoom <= ZOOM_MIN}
							onClick={() => bumpZoom(-1)}
							title="Zoom out"
							aria-label="Zoom out"
						>
							−
						</button>
						<span
							className="image-view-panel__zoom-readout mono"
							title="Scroll to pan · ⌘/Ctrl+wheel to zoom"
						>
							{Math.round(zoom * 100)}%
						</span>
						<button
							type="button"
							disabled={busy || zoom >= ZOOM_MAX}
							onClick={() => bumpZoom(1)}
							title="Zoom in"
							aria-label="Zoom in"
						>
							+
						</button>
						<button
							type="button"
							disabled={busy || zoom === 1}
							onClick={resetZoom}
							title="Fit entire cutaway in view"
						>
							Fit
						</button>
					</div>
				</section>
			)}
		</aside>
	);
}

export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP };
