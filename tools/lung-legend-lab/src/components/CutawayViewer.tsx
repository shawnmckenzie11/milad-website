import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Annotation, BoxGeom, EditMode, FindingInstance, LegendItemRow, TracePoint } from '../types';
import { assetUrl } from '../api';

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
	/** 'all' or a legend code — show only that layer's outline + hits */
	layerFilter: string;
	pathwayFilter: string;
	annotations: Annotation[];
	bust: number;
	selectedFinding: SelectedFinding | null;
	editMode: EditMode;
	onSelectFinding: (finding: SelectedFinding | null) => void;
	onSelectCode: (code: string) => void;
	/** Persist relocate / resize / trace geometry feedback. */
	onGeometryFeedback: (payload: {
		code: string;
		kind: 'relocate' | 'resize' | 'trace';
		from?: BoxGeom | null;
		to?: BoxGeom | null;
		points?: TracePoint[] | null;
	}) => void;
};

type FlatFinding = SelectedFinding & { minScore: number | null };

const HIT_RADIUS = 42;
const PICK_RADIUS = 40;
const DEFAULT_BOX = 36;

type DragState =
	| {
			kind: 'relocate';
			from: BoxGeom;
	  }
	| {
			kind: 'resize';
			corner: 'nw' | 'ne' | 'sw' | 'se';
			from: BoxGeom;
			cx: number;
			cy: number;
			w: number;
			h: number;
	  }
	| null;

/**
 * Interactive cutaway viewer with reliable hit targets, outline overlays, and
 * tier-2 relocate / resize / freehand-trace geometry feedback.
 */
export function CutawayViewer({
	items,
	outlineSlugs,
	selectedCode,
	layerFilter,
	pathwayFilter,
	annotations,
	bust,
	selectedFinding,
	editMode,
	onSelectFinding,
	onSelectCode,
	onGeometryFeedback,
}: Props) {
	const stageRef = useRef<HTMLDivElement>(null);
	const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
	const [drag, setDrag] = useState<DragState>(null);
	const [tracePoints, setTracePoints] = useState<TracePoint[]>([]);
	const [tracing, setTracing] = useState(false);
	const [localBox, setLocalBox] = useState<BoxGeom | null>(null);
	const [proposeCode, setProposeCode] = useState('');

	const visibleItems = useMemo(() => {
		return items.filter((it) => {
			if (!it.instances?.length) return false;
			if (layerFilter !== 'all' && it.code !== layerFilter) return false;
			if (selectedCode && layerFilter === 'all' && it.code === selectedCode) return true;
			if (pathwayFilter === 'all') return true;
			const supports = (it.supports || '').toLowerCase();
			if (pathwayFilter === 'all-pathways') return supports.includes('all');
			return supports.includes(pathwayFilter.toLowerCase());
		});
	}, [items, pathwayFilter, selectedCode, layerFilter]);

	const flats: FlatFinding[] = useMemo(() => {
		const out: FlatFinding[] = [];
		for (const it of visibleItems) {
			it.instances.forEach((instance, index) => {
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
	}, [visibleItems]);

	const overlays = useMemo(() => {
		const slugs = new Set<string>();
		for (const it of visibleItems) {
			if (it.slug && outlineSlugs.includes(it.slug)) slugs.add(it.slug);
		}
		const list = [...slugs];
		const focusCode = layerFilter !== 'all' ? layerFilter : selectedCode;
		if (focusCode) {
			const sel = items.find((i) => i.code === focusCode);
			if (sel?.slug && outlineSlugs.includes(sel.slug)) {
				return [...list.filter((s) => s !== sel.slug), sel.slug];
			}
		}
		return list;
	}, [visibleItems, outlineSlugs, selectedCode, items, layerFilter]);

	useEffect(() => {
		if (!selectedFinding) {
			setLocalBox(null);
			return;
		}
		const cx = selectedFinding.instance.cx ?? 0;
		const cy = selectedFinding.instance.cy ?? 0;
		setLocalBox({
			cx,
			cy,
			w: selectedFinding.instance.w ?? DEFAULT_BOX,
			h: selectedFinding.instance.h ?? DEFAULT_BOX,
		});
	}, [selectedFinding]);

	useEffect(() => {
		if (layerFilter !== 'all') setProposeCode(layerFilter);
	}, [layerFilter]);

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
	 * Build a box geometry snapshot from the selected finding (or local override).
	 * @param finding - Selected match
	 * @param override - Optional live drag box
	 */
	function boxFromFinding(finding: SelectedFinding, override?: BoxGeom | null): BoxGeom {
		const base = override || {
			cx: finding.instance.cx ?? 0,
			cy: finding.instance.cy ?? 0,
			w: finding.instance.w ?? DEFAULT_BOX,
			h: finding.instance.h ?? DEFAULT_BOX,
		};
		return {
			cx: base.cx,
			cy: base.cy,
			w: base.w ?? DEFAULT_BOX,
			h: base.h ?? DEFAULT_BOX,
		};
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
	 * Stroke color for a hit marker based on review status (yellow = unreviewed).
	 * @param ann - Annotation for this center, if any
	 */
	function strokeFor(ann: Annotation | undefined): string {
		if (ann?.label === 'false-positive') return '#c0392b';
		if (ann?.label === 'confirmed') return '#1e8449';
		if (ann?.label === 'reassigned') return '#b9770e';
		return '#e6b800';
	}

	/**
	 * Handle stage pointer-down for select / relocate / resize / trace modes.
	 * @param e - Pointer event
	 */
	function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
		const pt = toNative(e);
		setCursor(pt);

		if (editMode === 'trace') {
			setTracing(true);
			setTracePoints([pt]);
			e.currentTarget.setPointerCapture(e.pointerId);
			return;
		}

		if (editMode === 'select') {
			const hit = nearestFinding(pt.x, pt.y);
			if (hit) selectHit(hit);
			else onSelectFinding(null);
			return;
		}

		if (!selectedFinding || !localBox) return;

		if (editMode === 'relocate') {
			const from = boxFromFinding(selectedFinding, localBox);
			setDrag({ kind: 'relocate', from });
			e.currentTarget.setPointerCapture(e.pointerId);
		}
	}

	/**
	 * Start a corner-handle resize drag for the selected match.
	 * @param corner - Which bbox corner
	 * @param e - Pointer event
	 */
	function onResizeHandleDown(corner: 'nw' | 'ne' | 'sw' | 'se', e: PointerEvent<SVGCircleElement>) {
		e.stopPropagation();
		if (!selectedFinding || !localBox) return;
		const from = boxFromFinding(selectedFinding, localBox);
		setDrag({
			kind: 'resize',
			corner,
			from,
			cx: from.cx,
			cy: from.cy,
			w: from.w ?? DEFAULT_BOX,
			h: from.h ?? DEFAULT_BOX,
		});
		stageRef.current?.setPointerCapture(e.pointerId);
	}

	/**
	 * Update live drag / trace geometry while the pointer moves.
	 * @param e - Pointer event
	 */
	function onStagePointerMove(e: PointerEvent<HTMLDivElement>) {
		const pt = toNative(e);
		setCursor(pt);

		if (tracing && editMode === 'trace') {
			setTracePoints((prev) => {
				const last = prev[prev.length - 1];
				if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < 1.5) return prev;
				return [...prev, pt];
			});
			return;
		}

		if (!drag) return;

		if (drag.kind === 'relocate') {
			setLocalBox({ ...drag.from, cx: pt.x, cy: pt.y });
			return;
		}

		const halfW = (drag.w || DEFAULT_BOX) / 2;
		const halfH = (drag.h || DEFAULT_BOX) / 2;
		let left = drag.cx - halfW;
		let right = drag.cx + halfW;
		let top = drag.cy - halfH;
		let bottom = drag.cy + halfH;
		if (drag.corner.includes('w')) left = pt.x;
		if (drag.corner.includes('e')) right = pt.x;
		if (drag.corner.includes('n')) top = pt.y;
		if (drag.corner.includes('s')) bottom = pt.y;
		const w = Math.max(8, Math.abs(right - left));
		const h = Math.max(8, Math.abs(bottom - top));
		const cx = (left + right) / 2;
		const cy = (top + bottom) / 2;
		setLocalBox({ cx, cy, w, h });
	}

	/**
	 * Commit relocate / resize / trace on pointer-up and persist feedback.
	 * @param e - Pointer event
	 */
	function onStagePointerUp(e: PointerEvent<HTMLDivElement>) {
		if (tracing && editMode === 'trace') {
			setTracing(false);
			const points = [...tracePoints];
			const last = toNative(e);
			const tail = points[points.length - 1];
			if (!tail || Math.hypot(tail.x - last.x, tail.y - last.y) > 1) {
				points.push(last);
			}
			setTracePoints([]);
			const code =
				selectedFinding?.code ||
				(layerFilter !== 'all' ? layerFilter : proposeCode) ||
				'';
			if (code && points.length >= 2) {
				onGeometryFeedback({ code, kind: 'trace', points, from: null, to: null });
			}
			return;
		}

		if (!drag || !selectedFinding || !localBox) {
			setDrag(null);
			return;
		}

		if (drag.kind === 'relocate') {
			onGeometryFeedback({
				code: selectedFinding.code,
				kind: 'relocate',
				from: drag.from,
				to: { ...drag.from, cx: localBox.cx, cy: localBox.cy },
			});
			onSelectFinding({
				...selectedFinding,
				instance: {
					...selectedFinding.instance,
					cx: localBox.cx,
					cy: localBox.cy,
				},
			});
		} else if (drag.kind === 'resize') {
			onGeometryFeedback({
				code: selectedFinding.code,
				kind: 'resize',
				from: drag.from,
				to: {
					cx: localBox.cx,
					cy: localBox.cy,
					w: localBox.w,
					h: localBox.h,
				},
			});
			onSelectFinding({
				...selectedFinding,
				instance: {
					...selectedFinding.instance,
					cx: localBox.cx,
					cy: localBox.cy,
					w: localBox.w,
					h: localBox.h,
				},
			});
		}
		setDrag(null);
	}

	const stageClass = [
		'viewer-stage',
		editMode === 'relocate' ? 'mode-relocate' : '',
		editMode === 'resize' ? 'mode-resize' : '',
		editMode === 'trace' ? 'mode-trace' : '',
		editMode === 'select' ? 'mode-select' : '',
	]
		.filter(Boolean)
		.join(' ');

	const displayBox =
		selectedFinding && localBox
			? localBox
			: selectedFinding
				? boxFromFinding(selectedFinding)
				: null;

	return (
		<div className="viewer-wrap">
			<div className="viewer-toolbar">
				<strong>
					Cutaway viewer
					{layerFilter !== 'all' ? ` · layer ${layerFilter}` : ''}
					{editMode !== 'select' ? ` · ${editMode}` : ''}
				</strong>
				<span className="cursor-readout">
					{cursor ? `x=${cursor.x}  y=${cursor.y}` : 'move cursor over image'}
				</span>
				<span className="muted">{flats.length} labeled findings</span>
				{editMode === 'trace' && !selectedFinding && layerFilter === 'all' && (
					<label className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
						Propose as
						<select value={proposeCode} onChange={(ev) => setProposeCode(ev.target.value)}>
							<option value="">— pick code —</option>
							{items.map((it) => (
								<option key={it.code} value={it.code}>
									{it.code}
								</option>
							))}
						</select>
					</label>
				)}
			</div>
			<div
				ref={stageRef}
				className={stageClass}
				onPointerMove={onStagePointerMove}
				onPointerLeave={() => setCursor(null)}
				onPointerDown={onStagePointerDown}
				onPointerUp={onStagePointerUp}
			>
				<img
					className="base"
					src={assetUrl('/api/assets/cutaway', bust)}
					alt="Cutaway"
					draggable={false}
				/>
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
						const cx = isSelected && displayBox ? displayBox.cx : (f.instance.cx ?? 0);
						const cy = isSelected && displayBox ? displayBox.cy : (f.instance.cy ?? 0);
						const score = f.instance.score ?? 0;
						const ann = annotationFor(f.code, f.instance.cx ?? 0, f.instance.cy ?? 0);
						const finalStroke = strokeFor(ann);
						const labelCode = ann?.reassignedCode || f.code;
						const tierBit = f.tier != null ? `T${f.tier}` : '';
						const short = f.name.trim().split(/\s+/).slice(0, 2).join(' ');
						const label = `${labelCode} ${short} ${tierBit} ${score.toFixed(2)}`
							.replace(/\s+/g, ' ')
							.trim();
						const labelW = Math.max(52, label.length * 6.2);
						return (
							<g
								key={`${f.code}-${f.index}-${f.instance.cx}-${f.instance.cy}`}
								className={`hit${isSelected ? ' selected' : ''}${ann ? ` ann-${ann.label}` : ' ann-unreviewed'}`}
								onPointerDown={(ev) => {
									if (editMode !== 'select') return;
									ev.stopPropagation();
									selectHit(f);
								}}
							>
								{/* Large invisible hit target — covers yellow outline rings */}
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
									r={isSelected ? 16 : 12}
									fill={isSelected ? `${finalStroke}55` : `${finalStroke}33`}
									stroke={finalStroke}
									strokeWidth={isSelected ? 3.2 : 2}
								/>
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
								{/* Invisible label hit rect */}
								<rect
									className="hit-target"
									x={cx + 14}
									y={cy - 20}
									width={labelW}
									height={18}
									fill="transparent"
								/>
							</g>
						);
					})}

					{selectedFinding && displayBox && editMode === 'resize' && (
						<g className="resize-box">
							<rect
								x={displayBox.cx - (displayBox.w ?? DEFAULT_BOX) / 2}
								y={displayBox.cy - (displayBox.h ?? DEFAULT_BOX) / 2}
								width={displayBox.w ?? DEFAULT_BOX}
								height={displayBox.h ?? DEFAULT_BOX}
								fill="rgba(230,184,0,0.12)"
								stroke="#e6b800"
								strokeWidth={1.5}
								strokeDasharray="4 3"
							/>
							{(
								[
									['nw', -1, -1],
									['ne', 1, -1],
									['sw', -1, 1],
									['se', 1, 1],
								] as const
							).map(([corner, sx, sy]) => {
								const hx = displayBox.cx + (sx * (displayBox.w ?? DEFAULT_BOX)) / 2;
								const hy = displayBox.cy + (sy * (displayBox.h ?? DEFAULT_BOX)) / 2;
								return (
									<circle
										key={corner}
										className="resize-handle"
										cx={hx}
										cy={hy}
										r={7}
										onPointerDown={(ev) => onResizeHandleDown(corner, ev)}
									/>
								);
							})}
						</g>
					)}

					{selectedFinding && displayBox && editMode === 'relocate' && (
						<g className="relocate-guide">
							<circle
								cx={displayBox.cx}
								cy={displayBox.cy}
								r={10}
								fill="rgba(230,184,0,0.35)"
								stroke="#e6b800"
								strokeWidth={2}
							/>
						</g>
					)}

					{tracePoints.length > 1 && (
						<polyline
							className="trace-stroke"
							points={tracePoints.map((p) => `${p.x},${p.y}`).join(' ')}
							fill="none"
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
	);
}
