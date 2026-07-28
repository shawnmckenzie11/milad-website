/**
 * Phase 2 lung-health visualization: outdoor Ottawa scene with hotspots
 * that arc into the subject’s nose, then reveal the shared cutaway and
 * linked program framing on Projects.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
	getCutawayStageAspect,
	LUNG_HEALTH_SELECT_PROJECT_EVENT,
	lungHealthVisual,
	type LungHealthPathway,
	type LungHealthPathwayId,
} from '../data/lungHealthVisual';
import LungHealthCutaway from './LungHealthCutaway';
import './LungHealthVisual.css';

/** Outdoor intake vs shared cutaway camera. */
type LungHealthView = 'outdoor' | 'cutaway';

/** Soft ease for caption / cutaway settle. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Number of sampled outdoor-zoom keyframes (linear blend between samples). */
const ZOOM_SAMPLE_COUNT = 12;

/**
 * Ease-in curve: slow start, gradually faster (smoothstep-weighted quad).
 * @param t - Progress from 0 to 1
 */
function easeInZoom(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	const quad = clamped * clamped;
	const cubic = clamped * clamped * clamped;
	return quad * 0.65 + cubic * 0.35;
}

/**
 * Samples a quadratic bezier through start → mid → end.
 * @param t - Progress from 0 to 1
 * @param start - Path start
 * @param mid - Arc control point
 * @param end - Path end
 */
function sampleQuadratic(t: number, start: number, mid: number, end: number): number {
	const u = 1 - t;
	return u * u * start + 2 * u * t * mid + t * t * end;
}

/**
 * Builds evenly timed keyframes with an ease-in value curve for smoother playback.
 * @param from - Start value
 * @param to - End value
 * @param count - Sample count including endpoints
 */
function sampleEaseInRange(from: number, to: number, count: number): number[] {
	const last = Math.max(2, count) - 1;
	return Array.from({ length: last + 1 }, (_, index) => {
		const t = index / last;
		return from + (to - from) * easeInZoom(t);
	});
}

/**
 * Builds ease-in keyframes along a curved arc (start → mid → end).
 * @param mid - Arc midpoint control value
 * @param end - Arc end value
 * @param count - Sample count including endpoints
 */
function sampleEaseInArc(mid: number, end: number, count: number): number[] {
	const last = Math.max(2, count) - 1;
	return Array.from({ length: last + 1 }, (_, index) => {
		const t = index / last;
		return sampleQuadratic(easeInZoom(t), 0, mid, end);
	});
}

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
 * Notifies the Projects page tabs to select the program linked to a pathway.
 * @param projectId - Project id from pathway metadata
 */
function notifyProgramTab(projectId: string) {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent(LUNG_HEALTH_SELECT_PROJECT_EVENT, {
			detail: { projectId },
		}),
	);
}

/**
 * Renders the Phase 2 outdoor scene with zoom into the shared cutaway.
 */
export default function LungHealthVisual() {
	const labelId = useId();
	const captionId = useId();
	const reduceMotion = useReducedMotion();
	const [view, setView] = useState<LungHealthView>('outdoor');
	const [activeId, setActiveId] = useState<LungHealthPathwayId | null>(null);
	const [hoveredId, setHoveredId] = useState<LungHealthPathwayId | null>(null);
	const activePathway = activeId ? pathwayById(activeId) : null;
	const hoveredPathway = hoveredId ? pathwayById(hoveredId) : null;
	const panelPathway = activePathway ?? hoveredPathway;
	const { scene, cutaway, transition } = lungHealthVisual;
	const focus = scene.subjectZoomFocus;
	const { arc } = transition;
	const outdoorAspect = transition.outdoorStageAspect;
	const cutawayAspect = getCutawayStageAspect(
		cutaway,
		transition.cutawayHeightScale,
	);

	const duration = reduceMotion ? 0.01 : transition.durationSec;
	const zoomScale = transition.outdoorZoomScale;
	const outdoorOrigin = {
		transformOrigin: `${focus.x}% ${focus.y}%`,
		willChange: 'transform, opacity',
	} as CSSProperties;

	const zoomTimes = Array.from(
		{ length: ZOOM_SAMPLE_COUNT },
		(_, index) => index / (ZOOM_SAMPLE_COUNT - 1),
	);
	const zoomScales = sampleEaseInRange(1, zoomScale, ZOOM_SAMPLE_COUNT);
	const zoomXs = sampleEaseInArc(arc.midX, arc.endX, ZOOM_SAMPLE_COUNT).map(
		(value) => `${value}%`,
	);
	const zoomYs = sampleEaseInArc(arc.midY, arc.endY, ZOOM_SAMPLE_COUNT).map(
		(value) => `${value}%`,
	);
	const fadeStart = Math.max(
		0,
		(transition.durationSec - 0.3) / transition.durationSec,
	);
	const zoomOpacities = zoomTimes.map((t) =>
		t < fadeStart ? 1 : 1 - (t - fadeStart) / (1 - fadeStart),
	);

	/**
	 * Selects a pathway, runs the outdoor → cutaway zoom, and syncs the program tab.
	 * @param id - Pathway id to activate
	 */
	function selectPathway(id: LungHealthPathwayId) {
		const pathway = pathwayById(id);
		setHoveredId(null);
		setActiveId(id);
		setView('cutaway');
		notifyProgramTab(pathway.projectId);
		document
			.getElementById('lung-health-visual')
			?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
	}

	/**
	 * Returns from the cutaway to the outdoor intake scene.
	 */
	function returnToOutdoor() {
		setView('outdoor');
		setActiveId(null);
		setHoveredId(null);
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
			<div className={view === 'cutaway' ? 'lhv__layout is-cutaway' : 'lhv__layout'}>
				<figure className="lhv__scene" aria-labelledby={labelId}>
					<span id={labelId} className="sr-only">
						Interactive lung health exposure pathways
					</span>

					{view === 'cutaway' && (
						<button
							type="button"
							className="lhv__back"
							onClick={returnToOutdoor}
							aria-label="Back to outdoor scene"
						>
							<svg
								className="lhv__back-icon"
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
							>
								<path d="M15 6l-6 6 6 6" />
							</svg>
						</button>
					)}

					<motion.div
						className="lhv__stage"
						initial={false}
						animate={{ aspectRatio: view === 'cutaway' ? cutawayAspect : outdoorAspect }}
						transition={{
							duration: reduceMotion ? 0 : view === 'cutaway' ? duration : 0.45,
							ease: EASE_OUT,
						}}
					>
						<AnimatePresence mode="sync" initial={false}>
							{view === 'outdoor' ? (
								<motion.div
									key="outdoor"
									className="lhv__view"
									initial={false}
									animate={{ opacity: 1, scale: 1, x: '0%', y: '0%' }}
									exit={
										reduceMotion
											? { opacity: 0 }
											: {
													opacity: zoomOpacities,
													scale: zoomScales,
													x: zoomXs,
													y: zoomYs,
												}
									}
									transition={
										reduceMotion
											? { duration: 0 }
											: {
													duration,
													ease: 'linear',
													times: zoomTimes,
												}
									}
									style={outdoorOrigin}
								>
									<img
										className="lhv__image"
										src={scene.imageSrc}
										alt={scene.imageAlt}
										width={1536}
										height={1024}
										decoding="async"
										draggable={false}
									/>
								</motion.div>
							) : (
								<motion.div
									key="cutaway"
									className="lhv__view lhv__view--cutaway"
									initial={reduceMotion ? false : { opacity: 0, scale: 1.04 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, transition: { duration: 0.2 } }}
									transition={{
										duration: reduceMotion ? 0 : 0.35,
										delay: reduceMotion ? 0 : Math.max(0, duration - 0.35),
										ease: EASE_OUT,
									}}
								>
									<LungHealthCutaway />
								</motion.div>
							)}
						</AnimatePresence>

						{view === 'outdoor' && (
							<div
								className="lhv__hotspots"
								role="group"
								aria-label="Exposure pathway hotspots"
							>
								{scene.hotspots.map((hotspot) => {
									const pathway = pathwayById(hotspot.id);

									return (
										<button
											key={hotspot.id}
											type="button"
											className="lhv__hotspot"
											style={
												{
													'--lhv-x': `${hotspot.x}%`,
													'--lhv-y': `${hotspot.y}%`,
													'--lhv-size': `${hotspot.size}%`,
												} as CSSProperties
											}
											aria-label={`${pathway.label} exposure pathway`}
											onMouseEnter={() => setHoveredId(hotspot.id)}
											onMouseLeave={() =>
												setHoveredId((current) =>
													current === hotspot.id ? null : current,
												)
											}
											onFocus={() => setHoveredId(hotspot.id)}
											onBlur={() =>
												setHoveredId((current) =>
													current === hotspot.id ? null : current,
												)
											}
											onClick={() => selectPathway(hotspot.id)}
											onKeyDown={(event) =>
												onHotspotKeyDown(event, hotspot.id)
											}
										>
											<span className="lhv__hotspot-ring" aria-hidden="true" />
										</button>
									);
								})}
							</div>
						)}
					</motion.div>
				</figure>

				<aside className="lhv__panel" aria-live="polite">
					<AnimatePresence mode="wait">
						{view === 'cutaway' && activePathway ? (
							<motion.div
								key={`open-${activePathway.id}`}
								className="lhv__panel-card"
								initial={reduceMotion ? false : { opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
								transition={{ duration: 0.28, ease: EASE_OUT }}
							>
								<p className="lhv__panel-eyebrow">{activePathway.label}</p>
								<h2 id={captionId} className="lhv__panel-title">
									{activePathway.previewTitle}
								</h2>
								<p className="lhv__panel-question">{activePathway.previewQuestion}</p>
								<p className="lhv__panel-caption">{activePathway.caption}</p>
								<a className="lhv__panel-link" href={`#${activePathway.projectId}`}>
									View full program
								</a>
							</motion.div>
						) : panelPathway ? (
							<motion.div
								key={`hover-${panelPathway.id}`}
								className="lhv__panel-card"
								initial={reduceMotion ? false : { opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
								transition={{ duration: 0.2, ease: EASE_OUT }}
							>
								<p className="lhv__panel-eyebrow">{panelPathway.label}</p>
								<h2 id={captionId} className="lhv__panel-title">
									{panelPathway.previewTitle}
								</h2>
								<p className="lhv__panel-question">{panelPathway.previewQuestion}</p>
								<p className="lhv__panel-cta">{panelPathway.previewCta}</p>
							</motion.div>
						) : (
							<motion.div
								key="idle"
								className="lhv__panel-card"
								initial={false}
								animate={{ opacity: 1 }}
							>
								<p className="lhv__panel-eyebrow">Exposure pathway</p>
								<h2 id={captionId} className="lhv__panel-title">
									Select a pathway
								</h2>
								<p className="lhv__panel-caption">
									Hover a source to preview the related research program, then click
									to explore the airway cutaway.
								</p>
							</motion.div>
						)}
					</AnimatePresence>
				</aside>
			</div>
		</div>
	);
}
