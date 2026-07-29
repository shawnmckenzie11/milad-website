import {
	useEffect,
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
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './ImageViewPanel';

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
};

type FlatFinding = SelectedFinding & { minScore: number | null };

const HIT_RADIUS = 42;
const PICK_RADIUS = 40;
/** Native cutaway width / height (matches SVG viewBox). */
const CUTAWAY_ASPECT = 1024 / 953;

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
}: Props) {
	const stageRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
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
	 */
	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect;
			if (!cr) return;
			setViewportSize({ w: cr.width, h: cr.height });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	/**
	 * Width at 1× such that the full 1024×953 image fits inside the viewport.
	 */
	const fitWidthPx = useMemo(() => {
		if (viewportSize.w <= 1 || viewportSize.h <= 1) return null;
		// Floor slightly so Fit never needs a scrollbar that shrinks the viewport.
		return Math.max(1, Math.floor(Math.min(viewportSize.w, viewportSize.h * CUTAWAY_ASPECT)) - 1);
	}, [viewportSize]);

	/** Layout width for the zoom plane (native scroll when larger than the viewport). */
	const planeWidthPx = fitWidthPx != null ? fitWidthPx * zoom : null;

	/**
	 * Ctrl/Cmd + wheel zooms; plain wheel scrolls the viewport (vertical/horizontal).
	 */
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || !onZoomChange) return;
		/**
		 * Zoom only when a modifier is held so vertical scroll keeps working.
		 * @param e - Native wheel event
		 */
		function onWheel(e: globalThis.WheelEvent) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const direction = e.deltaY < 0 ? 1 : -1;
			const next = Math.round((zoom + direction * ZOOM_STEP) * 100) / 100;
			onZoomChange?.(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
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
	}, [zoom, fitWidthPx]);

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
	 * Map a pointer event into native 1024×953 cutaway coordinates.
	 * @param e - Pointer event with client coordinates
	 */
	function toNative(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const el = stageRef.current;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 1024;
		const y = ((e.clientY - rect.top) / rect.height) * 953;
		return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
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
	 * Stroke color: confirmed → green; unconfirmed / unreviewed → yellow; reassigned → amber.
	 * False positives are purged from overlays (never drawn).
	 * @param ann - Annotation for this center, if any
	 */
	function strokeFor(ann: Annotation | undefined): string {
		if (ann?.label === 'confirmed') return '#1e8449';
		if (ann?.label === 'reassigned') return '#b9770e';
		return '#e6b800';
	}

	/**
	 * Handle stage pointer-down for select, scroll-pan (when zoomed), or freehand-classify.
	 * @param e - Pointer event
	 */
	function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
		const pt = toNative(e);
		setCursor(pt);

		if (editMode === 'freehand-classify') {
			setClosedPreview(null);
			setTracing(true);
			setTracePoints([pt]);
			e.currentTarget.setPointerCapture(e.pointerId);
			return;
		}

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
			return;
		}

		if (!tracing || editMode !== 'freehand-classify') return;
		setTracePoints((prev) => {
			const last = prev[prev.length - 1];
			if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < 1.5) return prev;
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
			return;
		}

		if (!tracing || editMode !== 'freehand-classify') return;
		setTracing(false);
		const points = [...tracePoints];
		const last = toNative(e);
		const tail = points[points.length - 1];
		if (!tail || Math.hypot(tail.x - last.x, tail.y - last.y) > 1) {
			points.push(last);
		}
		setTracePoints([]);
		if (points.length < 3) return;
		setClosedPreview(points);
		onFreehandComplete(points);
	}

	const stageClass = [
		'viewer-stage',
		editMode === 'freehand-classify' ? 'mode-freehand' : '',
		editMode === 'select' ? 'mode-select' : '',
		zoom > 1 ? 'mode-zoomed' : '',
	]
		.filter(Boolean)
		.join(' ');

	const liveStroke = tracing && tracePoints.length > 1 ? tracePoints : null;
	const previewPoly = outlinePreview && outlinePreview.length > 2 ? outlinePreview : closedPreview;

	return (
		<div className={`viewer-wrap${processing ? ' viewer-wrap--processing' : ''}`}>
			<div ref={viewportRef} className="viewer-viewport">
				<div
					className="viewer-zoom-plane"
					style={
						planeWidthPx != null
							? { width: `${planeWidthPx}px` }
							: { width: '100%', maxWidth: 1024 }
					}
				>
					<div
						ref={stageRef}
						className={stageClass}
						onPointerMove={onStagePointerMove}
						onPointerLeave={() => setCursor(null)}
						onPointerDown={onStagePointerDown}
						onPointerUp={onStagePointerUp}
						aria-busy={processing || undefined}
					>
						<img
							className="base"
							src={assetUrl('/api/assets/cutaway', bust)}
							alt="Cutaway"
							draggable={false}
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
						<svg viewBox="0 0 1024 953" preserveAspectRatio="none" className="hit-layer">
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
								const finalStroke = strokeFor(ann);
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
										<circle
											className="hit-target"
											cx={cx}
											cy={cy}
											r={HIT_RADIUS}
											fill="transparent"
											stroke="none"
										/>
										<circle
											className="hit-ring"
											cx={cx}
											cy={cy}
											r={isSelected || isFlash ? 18 : 12}
											fill={
												isFlash
													? 'rgba(255, 210, 74, 0.45)'
													: isSelected
														? `${finalStroke}55`
														: `${finalStroke}33`
											}
											stroke={isFlash ? '#ffd24a' : finalStroke}
											strokeWidth={isSelected || isFlash ? 4 : 2}
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
										y2={953}
										stroke="rgba(255,255,255,0.25)"
										strokeWidth={1}
									/>
									<line
										x1={0}
										y1={cursor.y}
										x2={1024}
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

