import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TracePoint } from '../types';
import { applyManualClose, closureGap, dist } from '../lib/freehandGeometry';
import { assetUrl } from '../api';

type Props = {
	/** Open freehand stroke that could not be auto-closed. */
	points: TracePoint[];
	bust: number;
	busy?: boolean;
	onCancel: () => void;
	/** Called with cleaned, closed outline after manual bridge. */
	onClosed: (closed: TracePoint[]) => void;
};

/**
 * Zoomed editor to manually bridge a freehand gap that is not obvious to auto-close.
 * Shows a crop around the start/end gap; owner draws the connecting stroke.
 */
export function FreehandCloseEditor({ points, bust, busy = false, onCancel, onClosed }: Props) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [bridge, setBridge] = useState<TracePoint[]>([]);
	const [drawing, setDrawing] = useState(false);
	const gap = closureGap(points);
	const first = points[0];
	const last = points[points.length - 1];

	const crop = useMemo(() => {
		const cx = (first.x + last.x) / 2;
		const cy = (first.y + last.y) / 2;
		const span = Math.max(80, gap * 2.2, 140);
		const x0 = Math.max(0, cx - span / 2);
		const y0 = Math.max(0, cy - span / 2);
		const w = Math.min(1024 - x0, span);
		const h = Math.min(953 - y0, span);
		return { x0, y0, w, h };
	}, [first, last, gap]);

	/**
	 * Map pointer into native cutaway coordinates inside the crop viewBox.
	 * @param e - Pointer event
	 */
	function toNative(e: { clientX: number; clientY: number }): TracePoint {
		const el = svgRef.current;
		if (!el) return { x: first.x, y: first.y };
		const rect = el.getBoundingClientRect();
		const x = crop.x0 + ((e.clientX - rect.left) / rect.width) * crop.w;
		const y = crop.y0 + ((e.clientY - rect.top) / rect.height) * crop.h;
		return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
	}

	/**
	 * Start a bridge stroke from the open end toward the start.
	 * @param e - Pointer down
	 */
	function onPointerDown(e: ReactPointerEvent) {
		if (busy) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		setDrawing(true);
		const p = toNative(e);
		setBridge([last, p]);
	}

	/**
	 * Extend the bridge stroke.
	 * @param e - Pointer move
	 */
	function onPointerMove(e: ReactPointerEvent) {
		if (!drawing) return;
		const p = toNative(e);
		setBridge((prev) => {
			const tail = prev[prev.length - 1];
			if (tail && dist(tail, p) < 1.2) return prev;
			return [...prev, p];
		});
	}

	/**
	 * Finish the bridge stroke (does not submit yet).
	 */
	function onPointerUp() {
		setDrawing(false);
	}

	/**
	 * Apply bridge, clean contour, and hand closed outline to the classify form.
	 */
	function confirmClose() {
		const result = applyManualClose(points, bridge.length ? bridge : [last, first]);
		if (result.needsManualClose || result.points.length < 8) return;
		onClosed(result.points);
	}

	const preview = bridge.length > 1 ? bridge : null;
	const nearStart =
		bridge.length > 0 ? dist(bridge[bridge.length - 1], first) <= 20 : false;

	return (
		<div className="modal-backdrop" role="presentation">
			<div
				className="modal-card freehand-close-modal"
				role="dialog"
				aria-labelledby="freehand-close-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 id="freehand-close-title">Close freehand outline</h2>
				<p className="muted">
					Gap is {gap.toFixed(1)}px — not obvious enough to auto-close. Draw a bridge from the
					red end (open tip) to the green start in the zoomed crop, then confirm.
				</p>
				<div className="freehand-close-stage">
					<svg
						ref={svgRef}
						viewBox={`${crop.x0} ${crop.y0} ${crop.w} ${crop.h}`}
						className="freehand-close-svg"
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					>
						<image
							href={assetUrl('/api/assets/cutaway', bust)}
							x={0}
							y={0}
							width={1024}
							height={953}
							preserveAspectRatio="none"
						/>
						<polyline
							className="freehand-close-stroke"
							points={points.map((p) => `${p.x},${p.y}`).join(' ')}
							fill="none"
						/>
						{preview && (
							<polyline
								className="freehand-close-bridge"
								points={preview.map((p) => `${p.x},${p.y}`).join(' ')}
								fill="none"
							/>
						)}
						<circle cx={first.x} cy={first.y} r={5} fill="#1e8449" stroke="#fff" strokeWidth={1.5} />
						<circle cx={last.x} cy={last.y} r={5} fill="#c0392b" stroke="#fff" strokeWidth={1.5} />
					</svg>
				</div>
				<p className="muted mono">
					green=start · red=open tip
					{nearStart ? ' · tip near start — ready to confirm' : ''}
				</p>
				<div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
					<button type="button" disabled={busy} onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="primary"
						disabled={busy || (!nearStart && bridge.length < 2)}
						onClick={confirmClose}
					>
						Confirm close
					</button>
				</div>
			</div>
		</div>
	);
}
