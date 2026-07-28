/**
 * Cutaway coordinate metadata for Project 1 portal alignment.
 * Sourced from the Project 2 generator output in lungHealthLayers.generated.ts.
 */

import { lungHealthCutawayMeta } from './lungHealthLayers.generated';

/** Resolved cutaway geometry for camera math and portal handoff. */
export interface LungHealthCutawayGeometryResolved {
	viewBox: { width: number; height: number };
	entryAnchor: { x: number; y: number };
}

/**
 * Resolves cutaway viewBox and trachea entry anchor from generated layer metadata.
 */
export function resolveCutawayGeometry(): LungHealthCutawayGeometryResolved {
	return {
		viewBox: {
			width: lungHealthCutawayMeta.width,
			height: lungHealthCutawayMeta.height,
		},
		entryAnchor: lungHealthCutawayMeta.entryAnchor,
	};
}
