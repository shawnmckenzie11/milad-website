/**
 * Shared lung/airway cutaway artwork for Phases 2+.
 * Phase 3 will overlay pathway-specific highlight treatments on this base.
 */

import { lungHealthVisual } from '../data/lungHealthVisual';

/**
 * Renders the notes-free schematic cutaway image.
 */
export default function LungHealthCutaway() {
	const { cutaway } = lungHealthVisual;

	return (
		<img
			className="lhv__cutaway-image"
			src={cutaway.imageSrc}
			alt={cutaway.imageAlt}
			width={cutaway.width}
			height={cutaway.height}
			decoding="async"
			draggable={false}
		/>
	);
}
