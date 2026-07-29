import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent,
} from 'react';
import type {
	Annotation,
	EditMode,
	FindingInstance,
	LegendItemRow,
	StyleGuideProfileBrief,
	TracePoint,
	TrainingFeedback,
} from '../types';
import { assetUrl } from '../api';
import { collectPurgedHits, isHitPurged } from '../lib/purgedHits';
import {
	classifyMatchVsFreehand,
	summarizeFreehandPoints,
} from '../lib/freehandMatchReconcile';
import type { PathwayLayer } from '../lib/styleGuideLayers';
import {
	effectivePathwayIds,
	itemVisibleForPathwayView,
	pathwayLabels,
} from '../lib/styleGuideLayers';
import {
	OUTLINE_COLOR_HEX,
	OUTLINE_FILL_RGBA,
	OUTLINE_RING_PX,
} from '../lib/outlineStyle';
import { clampZoom, wheelZoomFactor } from '../lib/zoom';
import { DEFAULT_CUTAWAY_H, DEFAULT_CUTAWAY_W } from '../lib/cutawaySize';

export type SelectedFinding = {
	code: string;
	name: string;
	tier: number | null;
	slug: string | null;
	instance: FindingInstance;
	index: number;
};

type Props = {
	items: LegendItemRow[];
	outlineSlugs: string[];
	selectedCode: string | null;
	/** Observability tier scoping the verification set. */
	tierToTest: number;
	/** Style-guide pathway / image-layer catalog. */
	pathwayLayers: PathwayLayer[];
	/** Active style guide (legend-slug pathway defaults). */
	styleGuideProfile?: StyleGuideProfileBrief | null;
	/**
	 * Multi-select of pathway ids to show. Empty = show all pathways for the tier.
	 */
	viewPathwayIds: string[];
	/**
	 * Legend codes visible on the cutaway.
	 * `null` = all for the tier; `[]` = none; otherwise only listed codes.
	 */
	viewCodes?: string[] | null;
	/** When false, hide hit / freehand text labels (rings/outlines remain). */
	showLabels?: boolean;
	annotations: Annotation[];
	/** Persisted freehand closed loops (redrawn after refresh). */
	trainingFeedback: TrainingFeedback[];
	bust: number;
	selectedFinding: SelectedFinding | null;
	/**
	 * Short-lived attention flash for a hit (or freehand by code/id) after
	 * “Open in Image View” from Database View.
	 */
	hitFlash?: {
		code: string;
		index: number | null;
		nonce: number;
		kind?: 'match' | 'freehand';
		freehandId?: string | null;
	} | null;
	/** Called when the flash animation window ends so the parent can clear state. */
	onHitFlashEnd?: () => void;
	editMode: EditMode;
	/** Cutaway zoom scale (1 = fit). Controlled by ImageViewPanel. */
	zoom?: number;
	onZoomChange?: (zoom: number) => void;
	onSelectFinding: (finding: SelectedFinding | null) => void;
	onSelectCode: (code: string) => void;
	/**
	 * Called when a freehand stroke is completed (raw samples, not force-closed).
	 * Parent runs cleanFreehandOutline / optional manual-close editor.
	 * @param points - Raw polyline in native cutaway coords
	 */
	onFreehandComplete: (points: TracePoint[]) => void;
	/**
	 * Optional outline from parent (cleaned freehand or open stroke awaiting close).
	 * Overrides the local closed-preview when set.
	 */
	outlinePreview?: TracePoint[] | null;
	/** When true, dim the cutaway and show a Processing… overlay (match / save jobs). */
	processing?: boolean;
	/** Optional status line under Processing… (e.g. job kind). */
	processingLabel?: string;
	/**
	 * Reports the loaded cutaway's natural pixel size whenever it changes, so
	 * siblings (e.g. `FreehandCloseEditor`) can share the same source of truth.
	 */
	onCutawaySize?: (size: { w: number; h: number }) => void;
};

type FlatFinding = SelectedFinding & { minScore: number | null };

const HIT_RADIUS = 42;
const PICK_RADIUS = 40;
/** Minimum stroke sample spacing in screen px (converted to native per zoom level). */
const TRACE_SAMPLE_SCREEN_PX = 1.5;
/** Distance from a viewport edge at which a zoomed trace starts auto-panning. */
const TRACE_EDGE_PAN_MARGIN = 48;

/**
 * Ensure a polyline is closed by appending the first point when needed.
 * @param points - Open or already-closed stroke points
 */
export function closeLoop(points: TracePoint[]): TracePoint[] {
	if (points.length < 3) return points;
	const first = points[0];
	const last = points[points.length - 1];
	if (Math.hypot(first.x - last.x, first.y - last.y) < 1.5) {
		return [...points.slice(0, -1), { x: first.x, y: first.y }];
	}
	return [...points, { x: first.x, y: first.y }];
}

/**
 * Interactive cutaway viewer with hit targets, outline overlays, and
 * freehand closed-loop classification drawing.
 */
export function CutawayViewer({
	items,
	outlineSlugs,
	selectedCode,
	tierToTest,
	pathwayLayers,
	styleGuideProfile = null,
	viewPathwayIds,
	viewCodes = null,
	showLabels = true,
	annotations,
	trainingFeedback,
	bust,
	selectedFinding,
	hitFlash = null,
	onHitFlashEnd,
	editMode,
	zoom = 1,
	onZoomChange,
	onSelectFinding,
	onSelectCode,
	onFreehandComplete,
	outlinePreview = null,
	processing = false,
	processingLabel = 'Matching legend glyphs…',
	onCutawaySize,
}: Props) {
	const stageRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	/**
	 * Live cutaway pixel size — the single source of truth for pointer↔image
	 * mapping, the SVG viewBox, and stage aspect ratio. Starts at the
	 * canonical default and is corrected the moment the `<img>` reports its
	 * own naturalWidth/naturalHeight, so a 1184×1002 (or any other size)
	 * cutaway lines up exactly like the 1024×953 original.
	 */
	const [cutawaySize, setCutawaySize] = useState<{ w: number; h: number }>({
		w: DEFAULT_CUTAWAY_W,
		h: DEFAULT_CUTAWAY_H,
	});
	const cutawayW = cutawaySize.w;
	const cutawayH = cutawaySize.h;
	const cutawayAspect = cutawayW / cutawayH;
	const onCutawaySizeRef = useRef(onCutawaySize);
	onCutawaySizeRef.current = onCutawaySize;
	const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
	const [tracePoints, setTracePoints] = useState<TracePoint[]>([]);
	const [tracing, setTracing] = useState(false);
	/** Preview of the last completed closed loop until the form dismisses. */
	const [closedPreview, setClosedPreview] = useState<TracePoint[] | null>(null);
	/** Viewport content box used to compute contain-fit width. */
	const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
	/** True while the Database→Image flash animation should paint. */
	const [flashActive, setFlashActive] = useState(false);
	const onHitFlashEndRef = useRef(onHitFlashEnd);
	onHitFlashEndRef.current = onHitFlashEnd;
	/** Drag-to-scroll while zoomed (updates viewport scrollLeft/Top). */
	const panDrag = useRef<{
		pointerId: number;
		originX: number;
		originY: number;
		startScrollLeft: number;
		startScrollTop: number;
	} | null>(null);
	/**
	 * Art point that must stay under a given screen position across the next
	 * zoom relayout (set by wheel zoom; rail buttons fall back to view centre).
	 */
	const zoomFocus = useRef<{
		native: TracePoint;
		clientX: number;
		clientY: number;
	} | null>(null);
	/** Art point currently under the viewport centre — anchor for rail zoom. */
	const viewCenterNative = useRef<TracePoint>({
		x: DEFAULT_CUTAWAY_W / 2,
		y: DEFAULT_CUTAWAY_H / 2,
	});
	/** Previous plane width, used to detect a zoom / fit relayout. */
	const prevPlaneWidth = useRef<number | null>(null);
	/**
	 * Last good Fit width — ResizeObserver can briefly report 0×0 while the side
	 * rail reflows (e.g. switching to Add Freehand), which used to collapse the
	 * zoom plane back to a full-frame 100% width and look like zoom reset.
	 */
	const lastFitWidthPx = useRef<number | null>(null);
	/** Viewport scroll to restore across edit-mode / layout churn. */
	const savedScroll = useRef<{ left: number; top: number } | null>(null);

	/**
	 * Run a ~1.8s attention flash when hitFlash.nonce changes, then notify parent.
	 * Depends on nonce (not object identity) so deferred sets after Image View
	 * remount always restart the animation.
	 */
	useEffect(() => {
		if (!hitFlash?.nonce) {
			setFlashActive(false);
			return;
		}
		setFlashActive(true);
		const t = window.setTimeout(() => {
			setFlashActive(false);
			onHitFlashEndRef.current?.();
		}, 1800);
		return () => window.clearTimeout(t);
	}, [hitFlash?.nonce]);

	const visibleItems = useMemo(() => {
		const codeFilter =
			viewCodes == null ? null : new Set(viewCodes.filter((c) => c.length > 0));
		return items.filter((it) => {
			if (!it.instances?.length) return false;
			const t = it.tier;
			// Show prior searchable tiers plus current Tier to Test (matches left panel).
			if (t == null || t < 1 || t > tierToTest) return false;
			if (codeFilter && !codeFilter.has(it.code)) return false;
			if (viewCodes != null && viewCodes.length === 0) return false;
			const pathways = effectivePathwayIds(
				it.assignedPathways ?? it.assignedPathway,
				it.supports,
				{ code: it.code, profile: styleGuideProfile },
			);
			return itemVisibleForPathwayView(pathways, viewPathwayIds);
		});
	}, [items, tierToTest, viewPathwayIds, viewCodes, styleGuideProfile]);

	/**
	 * Track viewport size so Fit can contain the full cutaway (width and height).
	 * Ignore transient near-zero boxes during panel reflow so zoom does not snap.
	 */
	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect;
			if (!cr || cr.width < 32 || cr.height < 32) return;
			setViewportSize({ w: cr.width, h: cr.height });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	/**
	 * Recenter the zoom anchor and notify the parent whenever the loaded
	 * cutaway's real pixel size resolves (mount, or a different-size image
	 * swapped in). No-ops on a same-size reload (e.g. cache-bust only).
	 */
	useEffect(() => {
		viewCenterNative.current = { x: cutawayW / 2, y: cutawayH / 2 };
		onCutawaySizeRef.current?.({ w: cutawayW, h: cutawayH });
	}, [cutawayW, cutawayH]);

	/**
	 * Capture the cutaway `<img>`'s real pixel size once it loads, replacing
	 * the canonical-size placeholder so every downstream mapping (pointer,
	 * SVG viewBox, aspect ratio) works for any cutaway resolution.
	 * @param e - Native image load event
	 */
	function handleBaseImageLoad(e: { currentTarget: HTMLImageElement }) {
		const w = e.currentTarget.naturalWidth || DEFAULT_CUTAWAY_W;
		const h = e.currentTarget.naturalHeight || DEFAULT_CUTAWAY_H;
		setCutawaySize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
	}

	/**
	 * Width at 1× such that the full cutaway image fits inside the viewport.
	 */
	const fitWidthPx = useMemo(() => {
		if (viewportSize.w < 32 || viewportSize.h < 32) {
			return lastFitWidthPx.current;
		}
		// Floor slightly so Fit never needs a scrollbar that shrinks the viewport.
		const next = Math.max(
			1,
			Math.floor(Math.min(viewportSize.w, viewportSize.h * cutawayAspect)) - 1,
		);
		lastFitWidthPx.current = next;
		return next;
	}, [viewportSize, cutawayAspect]);

	/** Layout width for the zoom plane (native scroll when larger than the viewport). */
	const planeWidthPx = fitWidthPx != null ? fitWidthPx * zoom : null;

	/**
	 * Remember scroll before freehand UI reflow, then put it back after layout.
	 * Add Freehand used to look like a Fit reset because the side panel reflow
	 * collapsed the zoom plane / zeroed scrollTop while zoom state stayed > 1.
	 */
	useLayoutEffect(() => {
		const vp = viewportRef.current;
		if (!vp) return;
		const stillZoomedPlane =
			vp.scrollWidth > vp.clientWidth + 2 || vp.scrollHeight > vp.clientHeight + 2;
		if (stillZoomedPlane) {
			savedScroll.current = { left: vp.scrollLeft, top: vp.scrollTop };
		}
		if (editMode !== 'freehand-classify' || zoom <= 1) return;
		const saved = savedScroll.current;
		if (!saved) return;
		vp.scrollLeft = saved.left;
		vp.scrollTop = saved.top;
	}, [editMode, planeWidthPx, zoom]);

	/**
	 * Ctrl/Cmd + wheel zooms; plain wheel scrolls the viewport (vertical/horizontal).
	 */
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || !onZoomChange) return;
		/**
		 * Zoom only when a modifier is held so vertical scroll keeps working.
		 * Scales multiplicatively by wheel delta and pins the art under the
		 * cursor so the view creeps instead of jumping.
		 * @param e - Native wheel event
		 */
		function onWheel(e: globalThis.WheelEvent) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const next = clampZoom(zoom * wheelZoomFactor(e.deltaY));
			if (next === zoom) return;
			zoomFocus.current = {
				native: toNativeClient(e.clientX, e.clientY),
				clientX: e.clientX,
				clientY: e.clientY,
			};
			onZoomChange?.(next);
		}
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, [zoom, onZoomChange]);

	/** Reset scroll when returning to Fit so the full frame is visible. */
	useEffect(() => {
		if (zoom !== 1) return;
		const el = viewportRef.current;
		if (!el) return;
		el.scrollLeft = 0;
		el.scrollTop = 0;
		savedScroll.current = { left: 0, top: 0 };
	}, [zoom]);

	/**
	 * Keep the anchor art point under the same screen position after a zoom
	 * relayout: wheel zoom pins the cursor, rail zoom pins the view centre.
	 * Runs before paint so the correction is never visible as a jump.
	 */
	useLayoutEffect(() => {
		const vp = viewportRef.current;
		const stage = stageRef.current;
		const prev = prevPlaneWidth.current;
		prevPlaneWidth.current = planeWidthPx;
		if (!vp || !stage || planeWidthPx == null || prev == null || planeWidthPx === prev) {
			return;
		}
		const focus = zoomFocus.current;
		zoomFocus.current = null;
		const viewRect = vp.getBoundingClientRect();
		const anchor = focus?.native ?? viewCenterNative.current;
		const targetX = focus ? focus.clientX : viewRect.left + viewRect.width / 2;
		const targetY = focus ? focus.clientY : viewRect.top + viewRect.height / 2;
		const stageRect = stage.getBoundingClientRect();
		vp.scrollLeft += stageRect.left + (anchor.x / cutawayW) * stageRect.width - targetX;
		vp.scrollTop += stageRect.top + (anchor.y / cutawayH) * stageRect.height - targetY;
		rememberViewCenter();
	}, [planeWidthPx]);

	const flats: FlatFinding[] = useMemo(() => {
		const purged = collectPurgedHits(trainingFeedback, annotations);
		const freehandByCode = new Map<
			string,
			{ cx: number; cy: number; w: number; h: number }
		>();
		for (const f of trainingFeedback) {
			if (f.kind !== 'freehand-classify') continue;
			const geo = summarizeFreehandPoints(f.points);
			if (geo && f.code) freehandByCode.set(f.code, geo);
		}
		const out: FlatFinding[] = [];
		for (const it of visibleItems) {
			it.instances.forEach((instance, index) => {
				const cx = instance.cx ?? 0;
				const cy = instance.cy ?? 0;
				// FP-classified hits are archived — hide from active overlays / picks.
				if (isHitPurged(it.code, cx, cy, purged)) return;
				const fh = freehandByCode.get(it.code);
				if (fh) {
					const verdict = classifyMatchVsFreehand(
						{ cx, cy, w: instance.w, h: instance.h },
						fh,
					);
					if (verdict === 'incompatible') return;
				}
				out.push({
					code: it.code,
					name: it.name,
					tier: it.tier,
					slug: it.slug,
					instance,
					index,
					minScore: it.minScore ?? null,
				});
			});
		}
		return out;
	}, [visibleItems, trainingFeedback, annotations]);

	const overlays = useMemo(() => {
		const slugs = new Set<string>();
		for (const it of visibleItems) {
			if (it.slug && outlineSlugs.includes(it.slug)) slugs.add(it.slug);
		}
		// Drop outline overlays for codes whose only hits are incompatible with freehand.
		const flatCodes = new Set(flats.map((f) => f.code));
		for (const it of visibleItems) {
			if (!flatCodes.has(it.code) && it.slug) slugs.delete(it.slug);
		}
		const list = [...slugs];
		if (selectedCode) {
			const sel = items.find((i) => i.code === selectedCode);
			if (sel?.slug && outlineSlugs.includes(sel.slug) && flatCodes.has(selectedCode)) {
				return [...list.filter((s) => s !== sel.slug), sel.slug];
			}
		}
		return list;
	}, [visibleItems, outlineSlugs, selectedCode, items, flats]);

	/**
	 * Persisted expert freehand outlines visible for the current tier / pathway view.
	 * Superseded when a compatible algorithm hit exists for the same code.
	 */
	const savedFreehands = useMemo(() => {
		const codeFilter =
			viewCodes == null ? null : new Set(viewCodes.filter((c) => c.length > 0));
		const superseded = new Set<string>();
		for (const it of items) {
			const fhEntry = trainingFeedback.find(
				(f) => f.kind === 'freehand-classify' && f.code === it.code,
			);
			const geo = summarizeFreehandPoints(fhEntry?.points);
			if (!geo) continue;
			for (const instance of it.instances || []) {
				const cx = instance.cx ?? 0;
				const cy = instance.cy ?? 0;
				if (
					classifyMatchVsFreehand({ cx, cy, w: instance.w, h: instance.h }, geo) ===
					'compatible'
				) {
					superseded.add(it.code);
					break;
				}
			}
		}
		return trainingFeedback.filter((f) => {
			if (f.kind !== 'freehand-classify') return false;
			if (superseded.has(f.code)) return false;
			if (!f.points || f.points.length < 3) return false;
			const tier = f.tier ?? null;
			// Include freehands from prior searchable tiers through Tier to Test.
			if (tier != null && (tier < 1 || tier > tierToTest)) return false;
			if (viewCodes != null && viewCodes.length === 0) return false;
			if (codeFilter && !codeFilter.has(f.code)) return false;
			const legend = items.find((i) => i.code === f.code);
			const pathways = effectivePathwayIds(
				f.assignedPathways ??
					f.assignedPathway ??
					legend?.assignedPathways ??
					legend?.assignedPathway,
				legend?.supports,
				{ code: f.code, profile: styleGuideProfile },
			);
			return itemVisibleForPathwayView(pathways, viewPathwayIds);
		});
	}, [trainingFeedback, tierToTest, viewPathwayIds, viewCodes, items, styleGuideProfile]);

	useEffect(() => {
		if (editMode !== 'freehand-classify') {
			setTracePoints([]);
			setTracing(false);
			setClosedPreview(null);
		}
	}, [editMode]);

	/**
	 * Clear the closed-loop preview (called by parent after form save/cancel).
	 */
	useEffect(() => {
		if (editMode === 'select') setClosedPreview(null);
	}, [editMode]);

	/**
	 * Map a screen position into native cutaway pixel coordinates.
	 *
	 * The stage box is the zoom plane itself (the base image fills it exactly),
	 * so the rect ratio already divides out zoom and scroll: results are always
	 * native art pixels — the same space as match reports, freehand GT, and the
	 * analysis cutaway — never screen/CSS pixels. Scaled by the *loaded*
	 * cutaway's own naturalWidth/naturalHeight so this works identically at
	 * 1024×953, 1184×1002, or any other size.
	 *
	 * @param clientX - Viewport-relative screen x
	 * @param clientY - Viewport-relative screen y
	 */
	function toNativeClient(clientX: number, clientY: number): TracePoint {
		const el = stageRef.current;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0 };
		const x = ((clientX - rect.left) / rect.width) * cutawayW;
		const y = ((clientY - rect.top) / rect.height) * cutawayH;
		return {
			x: Math.round(Math.min(cutawayW, Math.max(0, x)) * 10) / 10,
			y: Math.round(Math.min(cutawayH, Math.max(0, y)) * 10) / 10,
		};
	}

	/**
	 * Map a pointer event into native cutaway pixel coordinates.
	 * @param e - Pointer event with client coordinates
	 */
	function toNative(e: { clientX: number; clientY: number }): TracePoint {
		return toNativeClient(e.clientX, e.clientY);
	}

	/**
	 * Cache the art point under the viewport centre so rail zoom can pin it.
	 */
	function rememberViewCenter() {
		const vp = viewportRef.current;
		if (!vp) return;
		const r = vp.getBoundingClientRect();
		viewCenterNative.current = toNativeClient(r.left + r.width / 2, r.top + r.height / 2);
		savedScroll.current = { left: vp.scrollLeft, top: vp.scrollTop };
	}

	/**
	 * Minimum spacing between stored stroke samples, in native units.
	 * Held constant on screen so a zoomed trace records proportionally finer
	 * detail instead of the same coarse native step.
	 */
	function traceSampleGap(): number {
		return Math.max(0.3, TRACE_SAMPLE_SCREEN_PX / Math.max(1, zoom));
	}

	/**
	 * Nudge the zoomed viewport when a live trace approaches its edge, so a
	 * region larger than the visible area can still be drawn continuously.
	 * @param clientX - Pointer screen x
	 * @param clientY - Pointer screen y
	 */
	function autoPanForTrace(clientX: number, clientY: number) {
		const vp = viewportRef.current;
		if (!vp || zoom <= 1) return;
		const r = vp.getBoundingClientRect();
		/**
		 * Scroll delta for one axis, ramping up as the pointer passes the margin.
		 * @param pos - Pointer position on the axis
		 * @param min - Leading edge of the viewport on the axis
		 * @param max - Trailing edge of the viewport on the axis
		 */
		const nudge = (pos: number, min: number, max: number): number => {
			const overLead = min + TRACE_EDGE_PAN_MARGIN - pos;
			if (overLead > 0) return -Math.min(24, overLead * 0.6);
			const overTrail = pos - (max - TRACE_EDGE_PAN_MARGIN);
			if (overTrail > 0) return Math.min(24, overTrail * 0.6);
			return 0;
		};
		vp.scrollLeft += nudge(clientX, r.left, r.right);
		vp.scrollTop += nudge(clientY, r.top, r.bottom);
	}

	/**
	 * Resolve annotation label for a match center, if any.
	 * @param code - Legend code
	 * @param cx - Center x
	 * @param cy - Center y
	 */
	function annotationFor(code: string, cx: number, cy: number): Annotation | undefined {
		return annotations.find(
			(a) => a.code === code && Math.abs(a.cx - cx) < 1.5 && Math.abs(a.cy - cy) < 1.5,
		);
	}

	/**
	 * Pick the nearest currently visible match within pick radius of art coords.
	 * @param x - Native cutaway x
	 * @param y - Native cutaway y
	 */
	function nearestFinding(x: number, y: number): FlatFinding | null {
		let best: FlatFinding | null = null;
		let bestDist = PICK_RADIUS;
		for (const f of flats) {
			const cx = f.instance.cx ?? 0;
			const cy = f.instance.cy ?? 0;
			const d = Math.hypot(cx - x, cy - y);
			if (d <= bestDist) {
				bestDist = d;
				best = f;
			}
		}
		return best;
	}

	/**
	 * Select a match and focus its layer code.
	 * @param f - Flat finding to select
	 */
	function selectHit(f: FlatFinding) {
		onSelectCode(f.code);
		onSelectFinding(f);
	}

	/**
	 * Handle stage pointer-down for scroll-pan (when zoomed), freehand-classify,
	 * or select. Pan is checked first so a zoomed trace can be repositioned
	 * without leaving freehand mode.
	 * @param e - Pointer event
	 */
	function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
		const pt = toNative(e);
		setCursor(pt);

		const wantPan =
			zoom > 1 && (e.button === 1 || e.altKey || (e.button === 0 && e.shiftKey));
		if (wantPan && viewportRef.current) {
			panDrag.current = {
				pointerId: e.pointerId,
				originX: e.clientX,
				originY: e.clientY,
				startScrollLeft: viewportRef.current.scrollLeft,
				startScrollTop: viewportRef.current.scrollTop,
			};
			e.currentTarget.setPointerCapture(e.pointerId);
			return;
		}

		if (editMode === 'freehand-classify') {
			setClosedPreview(null);
			setTracing(true);
			setTracePoints([pt]);
			e.currentTarget.setPointerCapture(e.pointerId);
			return;
		}

		const hit = nearestFinding(pt.x, pt.y);
		if (hit) selectHit(hit);
		else onSelectFinding(null);
	}

	/**
	 * Update live freehand stroke or viewport scroll-pan while the pointer moves.
	 * @param e - Pointer event
	 */
	function onStagePointerMove(e: PointerEvent<HTMLDivElement>) {
		const pt = toNative(e);
		setCursor(pt);

		if (panDrag.current && panDrag.current.pointerId === e.pointerId && viewportRef.current) {
			const dx = e.clientX - panDrag.current.originX;
			const dy = e.clientY - panDrag.current.originY;
			viewportRef.current.scrollLeft = panDrag.current.startScrollLeft - dx;
			viewportRef.current.scrollTop = panDrag.current.startScrollTop - dy;
			rememberViewCenter();
			return;
		}

		if (!tracing || editMode !== 'freehand-classify') return;
		autoPanForTrace(e.clientX, e.clientY);
		const gap = traceSampleGap();
		setTracePoints((prev) => {
			const last = prev[prev.length - 1];
			if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < gap) return prev;
			return [...prev, pt];
		});
	}

	/**
	 * Finish freehand stroke or end pan on pointer-up.
	 * @param e - Pointer event
	 */
	function onStagePointerUp(e: PointerEvent<HTMLDivElement>) {
		if (panDrag.current && panDrag.current.pointerId === e.pointerId) {
			panDrag.current = null;
			rememberViewCenter();
			return;
		}

		if (!tracing || editMode !== 'freehand-classify') return;
		const points = [...tracePoints];
		const last = toNative(e);
		const tail = points[points.length - 1];
		if (!tail || Math.hypot(tail.x - last.x, tail.y - last.y) > traceSampleGap()) {
			points.push(last);
		}
		finishTrace(points);
	}

	/**
	 * Hand a finished stroke to the parent (or discard a stub).
	 * @param points - Stroke samples in native cutaway coords
	 */
	function finishTrace(points: TracePoint[]) {
		setTracing(false);
		setTracePoints([]);
		if (points.length < 3) return;
		setClosedPreview(points);
		onFreehandComplete(points);
	}

	/**
	 * Salvage a stroke whose gesture the browser cancelled (scroll takeover,
	 * context menu, pointer loss) instead of leaving the stage stuck in tracing.
	 * @param e - Pointer cancel event
	 */
	function onStagePointerCancel(e: PointerEvent<HTMLDivElement>) {
		if (panDrag.current && panDrag.current.pointerId === e.pointerId) {
			panDrag.current = null;
			return;
		}
		if (!tracing) return;
		finishTrace([...tracePoints]);
	}

	const stageClass = [
		'viewer-stage',
		editMode === 'freehand-classify' ? 'mode-freehand' : '',
		editMode === 'select' ? 'mode-select' : '',
		// Zoomed select uses grab; freehand keeps crosshair but pan still works via
		// Shift / Alt / middle-drag (see onStagePointerDown).
		zoom > 1 && editMode !== 'freehand-classify' ? 'mode-zoomed' : '',
	]
		.filter(Boolean)
		.join(' ');

	const liveStroke = tracing && tracePoints.length > 1 ? tracePoints : null;
	const previewPoly = outlinePreview && outlinePreview.length > 2 ? outlinePreview : closedPreview;

	return (
		<div className={`viewer-wrap${processing ? ' viewer-wrap--processing' : ''}`}>
			<div ref={viewportRef} className="viewer-viewport" onScroll={rememberViewCenter}>
				<div
					className="viewer-zoom-plane"
					style={{
						aspectRatio: `${cutawayW} / ${cutawayH}`,
						...(planeWidthPx != null
							? { width: `${planeWidthPx}px` }
							: { width: '100%', maxWidth: cutawayW }),
					}}
				>
					<div
						ref={stageRef}
						className={stageClass}
						style={{ aspectRatio: `${cutawayW} / ${cutawayH}` }}
						onPointerMove={onStagePointerMove}
						onPointerLeave={() => setCursor(null)}
						onPointerDown={onStagePointerDown}
						onPointerUp={onStagePointerUp}
						onPointerCancel={onStagePointerCancel}
						aria-busy={processing || undefined}
					>
						<img
							className="base"
							src={assetUrl('/api/assets/cutaway', bust)}
							alt="Cutaway"
							draggable={false}
							onLoad={handleBaseImageLoad}
						/>
						{processing && (
							<div className="cutaway-processing-overlay" role="status" aria-live="polite">
								<span className="cutaway-processing-overlay__title">Processing…</span>
								{processingLabel ? (
									<span className="cutaway-processing-overlay__detail muted">
										{processingLabel}
									</span>
								) : null}
							</div>
						)}
						{overlays.map((slug) => (
							<img
								key={slug}
								className="outline"
								src={assetUrl(`/api/assets/outline/${slug}`, bust)}
								alt=""
								draggable={false}
							/>
						))}
						<svg
							viewBox={`0 0 ${cutawayW} ${cutawayH}`}
							preserveAspectRatio="none"
							className="hit-layer"
						>
							{flats.map((f) => {
								const isSelected =
									selectedFinding?.code === f.code && selectedFinding.index === f.index;
								const isFlash =
									flashActive &&
									hitFlash != null &&
									(hitFlash.kind ?? 'match') !== 'freehand' &&
									hitFlash.code === f.code &&
									hitFlash.index != null &&
									hitFlash.index === f.index;
								const cx = f.instance.cx ?? 0;
								const cy = f.instance.cy ?? 0;
								const score = f.instance.score ?? 0;
								const ann = annotationFor(f.code, f.instance.cx ?? 0, f.instance.cy ?? 0);
								const labelCode = ann?.reassignedCode || f.code;
								const tierBit = f.tier != null ? `T${f.tier}` : '';
								const short = f.name.trim().split(/\s+/).slice(0, 2).join(' ');
								const legend = items.find((i) => i.code === f.code);
								const pathwayBit = pathwayLabels(
									effectivePathwayIds(
										legend?.assignedPathways ?? legend?.assignedPathway,
										legend?.supports,
										{ code: f.code, profile: styleGuideProfile },
									),
									pathwayLayers,
								);
								const label = `${labelCode} ${short} ${pathwayBit} ${tierBit} ${score.toFixed(2)}`
									.replace(/\s+/g, ' ')
									.trim();
								const labelW = Math.max(52, label.length * 6.2);
								return (
									<g
										key={`${f.code}-${f.index}-${f.instance.cx}-${f.instance.cy}`}
										className={`hit${isSelected ? ' selected' : ''}${isFlash ? ' hit--flash' : ''}${ann ? ` ann-${ann.label}` : ' ann-unreviewed'}`}
										onPointerDown={(ev) => {
											if (editMode !== 'select') return;
											ev.stopPropagation();
											selectHit(f);
										}}
									>
										{isFlash && (
											<g className="hit-flash-center">
												<circle
													className="hit-flash-halo"
													cx={cx}
													cy={cy}
													r={22}
													fill="none"
													stroke="#ffd24a"
													strokeWidth={3}
												/>
												<circle
													className="hit-flash-halo hit-flash-halo--inner"
													cx={cx}
													cy={cy}
													r={12}
													fill="rgba(255, 210, 74, 0.35)"
													stroke="#ffd24a"
													strokeWidth={2}
												/>
											</g>
										)}
										{/* Invisible pick target — matches are shown by their
										    outline layer, never a centre marker. */}
										<circle
											className="hit-target"
											cx={cx}
											cy={cy}
											r={HIT_RADIUS}
											fill="transparent"
											stroke="none"
										/>
										{showLabels && (
											<g
												className={`hit-label-group${isFlash ? ' hit-label-group--flash' : ''}`}
											>
												<rect
													className="hit-label-bg"
													x={cx + 14}
													y={cy - 20}
													width={labelW}
													height={18}
													rx={3}
													fill="rgba(15,28,24,0.88)"
												/>
												<text
													className="hit-label"
													x={cx + 18}
													y={cy - 7}
													fill="#f4fffa"
													fontSize="11"
													fontFamily="ui-monospace, monospace"
												>
													{label}
												</text>
												<rect
													className="hit-target"
													x={cx + 14}
													y={cy - 20}
													width={labelW}
													height={18}
													fill="transparent"
												/>
											</g>
										)}
									</g>
								);
							})}

							{savedFreehands.map((f) => {
								const pts = f.points || [];
								const cx =
									pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
								const cy =
									pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
								const legend = items.find((i) => i.code === f.code);
								const name = (f.name || legend?.name || '').trim();
								const short = name.split(/\s+/).slice(0, 2).join(' ') || 'freehand';
								const pathwayBit = pathwayLabels(
									effectivePathwayIds(
										f.assignedPathways ??
											f.assignedPathway ??
											legend?.assignedPathways ??
											legend?.assignedPathway,
										legend?.supports,
										{ code: f.code, profile: styleGuideProfile },
									),
									pathwayLayers,
								);
								const score = f.score ?? 1;
								const tierBit = f.tier != null ? `T${f.tier}` : '';
								const conf =
									score >= 0.999 ? '100%' : `${Math.round(score * 100)}%`;
								const label = `${f.code} ${short} ${pathwayBit} ${tierBit} ${conf}`
									.replace(/\s+/g, ' ')
									.trim();
								const labelW = Math.max(72, label.length * 6.2);
								const isFlash =
									flashActive &&
									hitFlash != null &&
									(hitFlash.kind === 'freehand' ||
										hitFlash.index == null ||
										hitFlash.index < 0) &&
									hitFlash.code === f.code &&
									(hitFlash.freehandId == null ||
										hitFlash.freehandId === f.id);
								return (
									<g
										key={f.id}
										className={`freehand-saved${isFlash ? ' hit--flash' : ''}`}
										onPointerDown={(ev) => {
											if (editMode !== 'select') return;
											ev.stopPropagation();
											onSelectCode(f.code);
											onSelectFinding(null);
										}}
									>
										{isFlash && (
											<g className="hit-flash-center">
												<circle
													className="hit-flash-halo"
													cx={cx}
													cy={cy}
													r={26}
													fill="none"
													stroke="#ffd24a"
													strokeWidth={3}
												/>
												<circle
													className="hit-flash-halo hit-flash-halo--inner"
													cx={cx}
													cy={cy}
													r={14}
													fill="rgba(255, 210, 74, 0.28)"
													stroke="#ffd24a"
													strokeWidth={2}
												/>
											</g>
										)}
										<polygon
											className="freehand-saved-poly"
											points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
											fill={OUTLINE_FILL_RGBA}
											stroke={OUTLINE_COLOR_HEX}
											strokeWidth={OUTLINE_RING_PX}
											strokeLinejoin="round"
											strokeLinecap="round"
										/>
										{showLabels && (
											<g
												className={`hit-label-group${isFlash ? ' hit-label-group--flash' : ''}`}
											>
												<rect
													className="hit-label-bg"
													x={cx + 10}
													y={cy - 22}
													width={labelW}
													height={18}
													rx={3}
													fill="rgba(15,28,24,0.88)"
												/>
												<text
													className="hit-label"
													x={cx + 14}
													y={cy - 9}
													fill="#f4fffa"
													fontSize="11"
													fontFamily="ui-monospace, monospace"
												>
													{label}
												</text>
											</g>
										)}
									</g>
								);
							})}

							{liveStroke && (
								<>
									<polyline
										className="trace-stroke"
										points={liveStroke.map((p) => `${p.x},${p.y}`).join(' ')}
										fill="none"
									/>
									{cursor && liveStroke.length >= 2 && (
										<line
											className="trace-close-preview"
											x1={cursor.x}
											y1={cursor.y}
											x2={liveStroke[0].x}
											y2={liveStroke[0].y}
										/>
									)}
								</>
							)}

							{previewPoly && previewPoly.length > 2 && (
								<polygon
									className="freehand-closed"
									points={previewPoly.map((p) => `${p.x},${p.y}`).join(' ')}
									fill={OUTLINE_FILL_RGBA}
									stroke={OUTLINE_COLOR_HEX}
									strokeWidth={OUTLINE_RING_PX}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
							)}

						{cursor && editMode === 'select' && (
							<>
								<line
									x1={cursor.x}
									y1={0}
									x2={cursor.x}
									y2={cutawayH}
									stroke="rgba(255,255,255,0.25)"
									strokeWidth={1}
								/>
								<line
									x1={0}
									y1={cursor.y}
									x2={cutawayW}
									y2={cursor.y}
									stroke="rgba(255,255,255,0.25)"
									strokeWidth={1}
								/>
							</>
						)}
						</svg>
					</div>
				</div>
			</div>
		</div>
	);
}

