/**
 * Shared fallback for the cutaway's pixel dimensions.
 *
 * The lab must work for a cutaway of *any* size (e.g. a 1184×1002 re-export,
 * not just the original 1024×953 asset). These constants exist only as an
 * initial-render placeholder before the live `<img>` has reported its own
 * `naturalWidth`/`naturalHeight` — once known, that measured size is the
 * single source of truth for pointer↔image mapping, SVG viewBoxes, and
 * freehand geometry. Nothing should assume a cutaway is 1024×953.
 */
export const DEFAULT_CUTAWAY_W = 1024;
export const DEFAULT_CUTAWAY_H = 953;

/** Pixel dimensions of a loaded cutaway image. */
export type CutawaySize = { w: number; h: number };

export const DEFAULT_CUTAWAY_SIZE: CutawaySize = {
	w: DEFAULT_CUTAWAY_W,
	h: DEFAULT_CUTAWAY_H,
};
