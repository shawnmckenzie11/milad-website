/**
 * Shared lung/airway cutaway artwork for Phases 2–3.
 * Always renders cutaway-neutral.png at full fidelity.
 * Active pathway structures are marked with thick colored outline PNGs
 * (same-pixel extracts are invisible — outlines are the visibility layer).
 */

import { lungHealthCanvas } from '../data/lungHealthFeatureDatabase';
import {
	getActiveHighlightSlugs,
	lungHealthHighlightLayerSlugs,
	pathwayHighlightStyle,
} from '../data/lungHealthLayers';
import { lungHealthVisual, type LungHealthPathwayId } from '../data/lungHealthVisual';

/** Props for the interactive cutaway render island. */
export interface LungHealthCutawayProps {
	/** Active exposure pathway, or null when returning to the outdoor scene. */
	activePathwayId: LungHealthPathwayId | null;
}

/** Public path prefix for generator-produced outline PNGs. */
const LAYER_ASSET_PREFIX = '/figures/lung-health/layers';

/**
 * Resolves the thick-outline PNG path for a layer slug.
 * @param slug - Layer slug
 */
function outlineAssetSrc(slug: string): string {
	return `${LAYER_ASSET_PREFIX}/${slug}-outline.png`;
}

/**
 * Hex stroke → CSS filter approximation is unreliable; instead we rely on the
 * generator's high-visibility yellow outline and tint via drop-shadow + opacity.
 * Pathway accent is applied as an additional colored glow ring.
 * @param props - Cutaway render props
 */
export default function LungHealthCutaway({ activePathwayId }: LungHealthCutawayProps) {
	const { cutaway } = lungHealthVisual;
	const activeSlugs = getActiveHighlightSlugs(activePathwayId);
	const accent = activePathwayId ? pathwayHighlightStyle[activePathwayId] : null;

	return (
		<div className="lhv__cutaway-stack" role="img" aria-label={cutaway.imageAlt}>
			<img
				className="lhv__cutaway-base"
				src={lungHealthCanvas.sourceImage}
				alt=""
				width={lungHealthCanvas.width}
				height={lungHealthCanvas.height}
				decoding="async"
				draggable={false}
				aria-hidden="true"
			/>
			{lungHealthHighlightLayerSlugs.map((slug) => {
				const isActive = activeSlugs.has(slug);
				return (
					<img
						key={slug}
						id={`layer-${slug}`}
						className={
							isActive ? 'lhv__cutaway-outline is-active' : 'lhv__cutaway-outline'
						}
						src={outlineAssetSrc(slug)}
						alt=""
						width={lungHealthCanvas.width}
						height={lungHealthCanvas.height}
						decoding="async"
						draggable={false}
						aria-hidden="true"
						style={{
							opacity: isActive ? 1 : 0,
							...(isActive && accent
								? {
										filter: `drop-shadow(0 0 0 ${accent.stroke}) drop-shadow(0 0 10px ${accent.glow})`,
									}
								: undefined),
						}}
					/>
				);
			})}
		</div>
	);
}
