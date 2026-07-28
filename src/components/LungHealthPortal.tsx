/**
 * Circular portal vignette overlay for the nose → trachea handoff.
 */

import type { CSSProperties } from 'react';

export interface LungHealthPortalProps {
	/** Portal center as % of stage width. */
	centerXPercent: number;
	/** Portal center as % of stage height. */
	centerYPercent: number;
	/**
	 * Static fallback radius (% of min stage dimension).
	 * Omit when a parent animates `--lhv-portal-r`.
	 */
	maskRadiusPercent?: number;
	/** Overlay opacity (0 hides the portal layer). */
	opacity: number;
	/** Fill color revealed through the expanding aperture. */
	backgroundColor: string;
}

/**
 * Renders an expanding circular vignette aligned to the outdoor nose portal.
 * @param props - Portal center, radius, and background color
 */
export default function LungHealthPortal({
	centerXPercent,
	centerYPercent,
	maskRadiusPercent,
	opacity,
	backgroundColor,
}: LungHealthPortalProps) {
	if (opacity <= 0.01) {
		return null;
	}

	const style = {
		'--lhv-portal-x': `${centerXPercent}%`,
		'--lhv-portal-y': `${centerYPercent}%`,
		...(maskRadiusPercent !== undefined
			? { '--lhv-portal-r': `${maskRadiusPercent}%` }
			: {}),
		'--lhv-portal-bg': backgroundColor,
		opacity,
	} as CSSProperties;

	return (
		<div
			className="lhv__portal"
			style={style}
			aria-hidden="true"
		/>
	);
}
