/**
 * Phase 1 interactive lung-health scene: Ottawa outdoor artwork with
 * keyboard-accessible hotspots over the five bubble callouts.
 * No anatomy zoom or cutaway until Phase 2+.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useState, type KeyboardEvent } from 'react';
import {
	lungHealthVisual,
	type LungHealthPathway,
	type LungHealthPathwayId,
} from '../data/lungHealthVisual';
import './LungHealthVisual.css';

/**
 * Looks up pathway content for a hotspot id.
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
	const { scene } = lungHealthVisual;

	/**
	 * Selects or clears a pathway hotspot.
	 * @param id - Pathway id to activate
	 */
	function selectPathway(id: LungHealthPathwayId) {
		setActiveId((current) => (current === id ? null : id));
	}

	/**
	 * Handles keyboard activation for a hotspot button.
	 * @param event - Keyboard event from the hotspot
	 * @param id - Pathway id to activate
	 */
	function onHotspotKeyDown(
		event: KeyboardEvent<HTMLButtonElement>,
		id: LungHealthPathwayId,
	) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectPathway(id);
		}
	}

	return (
		<div className="lhv">
			<div className="lhv__layout">
				<figure className="lhv__scene" aria-labelledby={labelId}>
					<p id={labelId} className="lhv__scene-label">
						Outdoor exposure pathways — select a source
					</p>
					<div className="lhv__stage">
						<img
							className="lhv__image"
							src={scene.imageSrc}
							alt={scene.imageAlt}
							width={1600}
							height={900}
							decoding="async"
						/>
						<div className="lhv__hotspots" role="group" aria-label="Exposure pathway hotspots">
							{scene.hotspots.map((hotspot) => {
								const pathway = pathwayById(hotspot.id);
								const isActive = activeId === hotspot.id;
								const dimmed = Boolean(activeId && !isActive);

								return (
									<motion.button
										key={hotspot.id}
										type="button"
										className={
											isActive ? 'lhv__hotspot is-active' : 'lhv__hotspot'
										}
										style={{
											left: `${hotspot.x}%`,
											top: `${hotspot.y}%`,
											width: `${hotspot.size}%`,
										}}
										aria-pressed={isActive}
										aria-label={`${pathway.label} exposure pathway`}
										onClick={() => selectPathway(hotspot.id)}
										onKeyDown={(event) => onHotspotKeyDown(event, hotspot.id)}
										animate={
											reduceMotion
												? undefined
												: {
														scale: isActive ? 1.04 : 1,
														opacity: dimmed ? 0.55 : 1,
													}
										}
										transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
									>
										<span className="lhv__hotspot-ring" aria-hidden="true" />
									</motion.button>
								);
							})}
						</div>
					</div>
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
							<motion.div key="idle" initial={false} animate={{ opacity: 1 }}>
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
