/**
 * Phase 1 interactive lung-health scene: outdoor Ottawa placeholders,
 * five pathway hotspots, and an evidence-bound caption panel.
 * No anatomy zoom or cutaway until Phase 2+.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useState } from 'react';
import {
	lungHealthVisual,
	type LungHealthPathway,
	type LungHealthPathwayId,
} from '../data/lungHealthVisual';
import './LungHealthVisual.css';

/** SVG hotspot anchor for a pathway in the Phase 1 outdoor scene. */
interface HotspotLayout {
	id: LungHealthPathwayId;
	/** Circle center x in viewBox units. */
	cx: number;
	/** Circle center y in viewBox units. */
	cy: number;
	/** Line endpoint near the person's mouth/chest. */
	tx: number;
	/** Line endpoint near the person's mouth/chest. */
	ty: number;
}

const HOTSPOTS: HotspotLayout[] = [
	{ id: 'cannabis', cx: 168, cy: 168, tx: 448, ty: 268 },
	{ id: 'cigarette', cx: 132, cy: 292, tx: 444, ty: 286 },
	{ id: 'air', cx: 480, cy: 96, tx: 480, ty: 252 },
	{ id: 'vaping', cx: 792, cy: 168, tx: 512, ty: 268 },
	{ id: 'viruses', cx: 828, cy: 292, tx: 516, ty: 286 },
];

/**
 * Looks up pathway content for a hotspot layout entry.
 * @param id - Pathway id
 */
function pathwayById(id: LungHealthPathwayId): LungHealthPathway {
	const pathway = lungHealthVisual.pathways.find((entry) => entry.id === id);
	if (!pathway) {
		throw new Error(`Missing pathway content for ${id}`);
	}
	return pathway;
}

/**
 * Renders the Phase 1 outdoor scene with selectable exposure hotspots.
 */
export default function LungHealthVisual() {
	const labelId = useId();
	const captionId = useId();
	const reduceMotion = useReducedMotion();
	const [activeId, setActiveId] = useState<LungHealthPathwayId | null>(null);
	const activePathway = activeId ? pathwayById(activeId) : null;

	/**
	 * Selects or clears a pathway hotspot.
	 * @param id - Pathway id to activate
	 */
	function selectPathway(id: LungHealthPathwayId) {
		setActiveId((current) => (current === id ? null : id));
	}

	return (
		<div className="lhv">
			<div className="lhv__layout">
				<figure className="lhv__scene" aria-labelledby={labelId}>
					<p id={labelId} className="lhv__scene-label">
						Outdoor exposure pathways — select a source
					</p>
					<svg
						className="lhv__svg"
						viewBox="0 0 960 540"
						role="img"
						aria-describedby={captionId}
					>
						<title>Person outdoors in Ottawa with five exposure pathway hotspots</title>
						<defs>
							<linearGradient id="lhv-sky" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="#dce6ec" />
								<stop offset="55%" stopColor="#eef3f5" />
								<stop offset="100%" stopColor="#f7f9fa" />
							</linearGradient>
							<linearGradient id="lhv-ground" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="#c5d0d7" />
								<stop offset="100%" stopColor="#aebbc4" />
							</linearGradient>
						</defs>

						{/* Sky and ground */}
						<rect width="960" height="540" fill="url(#lhv-sky)" />
						<path d="M0 390 C 180 360, 360 410, 520 378 C 700 340, 820 400, 960 372 L 960 540 L 0 540 Z" fill="url(#lhv-ground)" />
						<path
							d="M0 392 C 180 362, 360 412, 520 380 C 700 342, 820 402, 960 374"
							fill="none"
							stroke="#8a97a1"
							strokeWidth="1.25"
							opacity="0.55"
						/>

						{/* Schematic Ottawa skyline (placeholder geometry) */}
						<g fill="#4a6274" opacity="0.28" aria-hidden="true">
							<rect x="70" y="268" width="46" height="118" />
							<rect x="128" y="236" width="58" height="150" />
							<path d="M204 214 L228 188 L252 214 V386 H204 Z" />
							<rect x="268" y="252" width="40" height="134" />
							<rect x="700" y="248" width="52" height="138" />
							<rect x="764" y="220" width="64" height="166" />
							<rect x="840" y="266" width="44" height="120" />
						</g>

						{/* Person silhouette (placeholder) */}
						<g fill="#3d5160" aria-hidden="true">
							<circle cx="480" cy="236" r="28" />
							<path d="M444 278 C 444 262, 516 262, 516 278 L 528 392 C 528 408, 512 418, 496 418 L 464 418 C 448 418, 432 408, 432 392 Z" />
							<path d="M452 418 V 498 H 468 V 418 Z" />
							<path d="M492 418 V 498 H 508 V 418 Z" />
							<path d="M444 300 L 404 356" stroke="#3d5160" strokeWidth="14" strokeLinecap="round" fill="none" />
							<path d="M516 300 L 556 356" stroke="#3d5160" strokeWidth="14" strokeLinecap="round" fill="none" />
						</g>

						{/* Guide lines from hotspots toward inhale point */}
						<g aria-hidden="true">
							{HOTSPOTS.map((hotspot) => {
								const isActive = activeId === hotspot.id;
								return (
									<line
										key={`line-${hotspot.id}`}
										x1={hotspot.cx}
										y1={hotspot.cy}
										x2={hotspot.tx}
										y2={hotspot.ty}
										stroke={isActive ? '#4a6274' : '#8a97a1'}
										strokeWidth={isActive ? 2 : 1.25}
										strokeDasharray={isActive ? '0' : '5 5'}
										opacity={activeId && !isActive ? 0.28 : 0.7}
									/>
								);
							})}
						</g>

						{/* Hotspots */}
						{HOTSPOTS.map((hotspot) => {
							const pathway = pathwayById(hotspot.id);
							const isActive = activeId === hotspot.id;
							return (
								<g key={hotspot.id} className="lhv__hotspot-group">
									<motion.circle
										cx={hotspot.cx}
										cy={hotspot.cy}
										r={isActive ? 34 : 30}
										fill={isActive ? '#4a6274' : '#ffffff'}
										stroke="#4a6274"
										strokeWidth="2"
										role="button"
										tabIndex={0}
										aria-pressed={isActive}
										aria-label={`${pathway.label} exposure pathway`}
										className="lhv__hotspot"
										onClick={() => selectPathway(hotspot.id)}
										onKeyDown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												selectPathway(hotspot.id);
											}
										}}
										animate={
											reduceMotion
												? undefined
												: { scale: isActive ? 1.06 : 1, opacity: activeId && !isActive ? 0.55 : 1 }
										}
										transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
										style={{ cursor: 'pointer', outline: 'none' }}
									/>
									<text
										x={hotspot.cx}
										y={hotspot.cy + 52}
										textAnchor="middle"
										className="lhv__hotspot-label"
										fill={isActive ? '#3d5160' : '#5a6d7a'}
										aria-hidden="true"
									>
										{pathway.label}
									</text>
								</g>
							);
						})}
					</svg>
				</figure>

				<aside className="lhv__panel" aria-live="polite">
					<p className="lhv__panel-eyebrow">Exposure pathway</p>
					<AnimatePresence mode="wait">
						{activePathway ? (
							<motion.div
								key={activePathway.id}
								initial={reduceMotion ? false : { opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
								transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
							>
								<h2 id={captionId} className="lhv__panel-title">
									{activePathway.label}
								</h2>
								<p className="lhv__panel-caption">{activePathway.caption}</p>
							</motion.div>
						) : (
							<motion.div
								key="idle"
								initial={false}
								animate={{ opacity: 1 }}
							>
								<h2 id={captionId} className="lhv__panel-title">
									Select a pathway
								</h2>
								<p className="lhv__panel-caption">
									Choose one of the five outdoor exposure sources to read the related
									research framing.
								</p>
							</motion.div>
						)}
					</AnimatePresence>
				</aside>
			</div>
		</div>
	);
}
