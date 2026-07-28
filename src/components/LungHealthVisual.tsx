/**
 * Phase 2 lung-health visualization: outdoor Ottawa scene with hotspots
 * that arc into the subject’s nose, then reveal the shared cutaway and
 * linked program framing on Projects.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
	type CSSProperties,
	type KeyboardEvent,
} from 'react';
import { resolveCutawayGeometry } from '../data/lungHealthCutawayGeometry';
import {
	getCutawayStageAspect,
	LUNG_HEALTH_SELECT_PROJECT_EVENT,
	lungHealthVisual,
	type LungHealthPathway,
	type LungHealthPathwayId,
} from '../data/lungHealthVisual';
import {
	getAdjacentPhase,
	getPhaseDurationSec,
	getPhaseStartFrame,
	sampleCameraFrame,
	type LungHealthCameraConfig,
	type LungHealthTransitionDirection,
	type LungHealthTransitionPhase,
} from '../lib/lungHealthCamera';
import LungHealthCutaway from './LungHealthCutaway';
import LungHealthPortal from './LungHealthPortal';
import './LungHealthVisual.css';

/** Soft ease for caption / panel settle. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Returns false during SSR and the first client pass so markup matches before motion mounts. */
function subscribeNoop() {
	return () => undefined;
}

/**
 * Gates Framer Motion layers until after hydration to avoid SSR/client transform mismatches.
 */
function useMotionReady(): boolean {
	return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/** Keyframe samples per animated phase for linear-times easing curves. */
const PHASE_SAMPLE_COUNT = 16;

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
 * Builds evenly spaced keyframe times for Framer Motion.
 * @param count - Number of keyframe samples
 */
function keyframeTimes(count: number): number[] {
	const last = Math.max(2, count) - 1;
	return Array.from({ length: last + 1 }, (_, index) => index / last);
}

/**
 * Samples outdoor transform keyframes for a transition phase.
 * @param phase - Active phase
 * @param direction - Forward or reverse playback
 * @param config - Camera configuration
 */
function outdoorPhaseAnimation(
	phase: LungHealthTransitionPhase,
	direction: LungHealthTransitionDirection,
	config: LungHealthCameraConfig,
) {
	const times = keyframeTimes(PHASE_SAMPLE_COUNT);
	const frames = times.map((progress) =>
		sampleCameraFrame(phase, progress, direction, config),
	);

	return {
		scale: frames.map((frame) => frame.outdoor.scale),
		x: frames.map((frame) => `${frame.outdoor.translateXPercent}%`),
		y: frames.map((frame) => `${frame.outdoor.translateYPercent}%`),
		opacity: frames.map((frame) => frame.outdoor.opacity),
		times,
		origins: frames.map((frame) => ({
			x: frame.outdoor.transformOriginXPercent,
			y: frame.outdoor.transformOriginYPercent,
		})),
		desaturate: frames.map((frame) => frame.outdoor.desaturate),
	};
}

/**
 * Renders the phased outdoor → cutaway cinematic transition.
 */
export default function LungHealthVisual() {
	const motionReady = useMotionReady();
	const reduceMotion = useReducedMotion();
	const [phase, setPhase] = useState<LungHealthTransitionPhase>('outdoorIdle');
	const [direction, setDirection] =
		useState<LungHealthTransitionDirection>('forward');
	const [activeId, setActiveId] = useState<LungHealthPathwayId | null>(null);
	const [hoveredId, setHoveredId] = useState<LungHealthPathwayId | null>(null);
	const [bubbleFocus, setBubbleFocus] = useState<{ x: number; y: number }>({
		x: 50,
		y: 50,
	});

	const activePathway = activeId ? pathwayById(activeId) : null;
	const hoveredPathway = hoveredId ? pathwayById(hoveredId) : null;
	const panelPathway = activePathway ?? hoveredPathway;
	const { scene, cutaway, transition } = lungHealthVisual;
	const cutawayGeometry = useMemo(() => resolveCutawayGeometry(), []);
	const outdoorAspect = transition.outdoorStageAspect;
	const cutawayAspect = getCutawayStageAspect(
		cutaway,
		transition.cutawayHeightScale,
	);

	const cameraConfig = useMemo<LungHealthCameraConfig>(
		() => ({
			bubbleFocus,
			portalFocus: scene.subjectZoomFocus,
			cutawayGeometry,
			arc: transition.arc,
			phases: transition.phases,
			outdoorZoomScale: transition.outdoorZoomScale,
			bubbleFocusScale: transition.bubbleFocusScale,
			cutawayRevealStartScale: transition.cutawayRevealStartScale,
			portalStartRadiusPercent: transition.portalStartRadiusPercent,
			portalMaxRadiusPercent: transition.portalMaxRadiusPercent,
			backgroundOutdoor: transition.backgroundOutdoor,
			backgroundCutaway: transition.backgroundCutaway,
		}),
		[bubbleFocus, cutawayGeometry, scene.subjectZoomFocus, transition],
	);

	const isCutawayStage =
		phase === 'portal' || phase === 'cutawayReveal' || phase === 'cutawayIdle';
	const showHotspots = phase === 'outdoorIdle' || phase === 'bubbleFocus';
	const staticFrame = useMemo(
		() => sampleCameraFrame(phase, 1, direction, cameraConfig),
		[phase, direction, cameraConfig],
	);

	const animatedPhase =
		phase === 'bubbleFocus' ||
		phase === 'travel' ||
		phase === 'portal' ||
		phase === 'cutawayReveal';

	const phaseDuration = animatedPhase
		? reduceMotion
			? 0
			: getPhaseDurationSec(phase, transition.phases)
		: 0;

	const outdoorAnim = animatedPhase
		? outdoorPhaseAnimation(phase, direction, cameraConfig)
		: null;

	const cutawayKeyframes = useMemo(() => {
		if (!animatedPhase) return null;
		const times = keyframeTimes(PHASE_SAMPLE_COUNT);
		const frames = times.map((progress) =>
			sampleCameraFrame(phase, progress, direction, cameraConfig),
		);
		return {
			scale: frames.map((frame) => frame.cutaway.scale),
			opacity: frames.map((frame) => frame.cutaway.opacity),
			times,
			originX: frames.at(-1)?.cutaway.transformOriginXPercent ?? 50,
			originY: frames.at(-1)?.cutaway.transformOriginYPercent ?? 50,
		};
	}, [animatedPhase, phase, direction, cameraConfig]);

	const portalKeyframes = useMemo(() => {
		if (!animatedPhase) return null;
		const times = keyframeTimes(PHASE_SAMPLE_COUNT);
		const frames = times.map((progress) =>
			sampleCameraFrame(phase, progress, direction, cameraConfig),
		);
		return {
			radius: frames.map((frame) => frame.portal.maskRadiusPercent),
			opacity: frames.map((frame) => frame.portal.opacity),
			centerX: frames.at(-1)?.portal.centerXPercent ?? scene.subjectZoomFocus.x,
			centerY: frames.at(-1)?.portal.centerYPercent ?? scene.subjectZoomFocus.y,
			times,
		};
	}, [animatedPhase, phase, direction, cameraConfig, scene.subjectZoomFocus]);

	const stageBackgroundKeyframes = useMemo(() => {
		if (!animatedPhase) return staticFrame.stageBackground;
		const times = keyframeTimes(PHASE_SAMPLE_COUNT);
		return times.map((progress) =>
			sampleCameraFrame(phase, progress, direction, cameraConfig).stageBackground,
		);
	}, [animatedPhase, phase, direction, cameraConfig, staticFrame.stageBackground]);

	const outdoorOrigin = outdoorAnim?.origins.at(-1) ?? {
		x: staticFrame.outdoor.transformOriginXPercent,
		y: staticFrame.outdoor.transformOriginYPercent,
	};

	useEffect(() => {
		const href = cutaway.imageSrc;
		const link = document.createElement('link');
		link.rel = 'preload';
		link.as = 'image';
		link.href = href;
		document.head.appendChild(link);
		void fetch(href).catch(() => undefined);
		return () => {
			link.remove();
		};
	}, [cutaway.imageSrc]);

	useEffect(() => {
		if (reduceMotion) return;
		if (phase === 'outdoorIdle' || phase === 'cutawayIdle') return;

		const durationMs = getPhaseDurationSec(phase, transition.phases) * 1000;
		const timer = window.setTimeout(() => {
			const next = getAdjacentPhase(phase, direction);
			setPhase(next);
			if (direction === 'reverse' && next === 'outdoorIdle') {
				setActiveId(null);
				setHoveredId(null);
			}
		}, durationMs);

		return () => window.clearTimeout(timer);
	}, [phase, direction, reduceMotion, transition.phases]);

	/**
	 * Selects a pathway and runs the phased outdoor → cutaway transition.
	 * @param id - Pathway id to activate
	 */
	function selectPathway(id: LungHealthPathwayId) {
		const pathway = pathwayById(id);
		const hotspot = scene.hotspots.find((entry) => entry.id === id);
		setHoveredId(null);
		setActiveId(id);
		setBubbleFocus(
			hotspot
				? { x: hotspot.x, y: hotspot.y }
				: { x: scene.subjectZoomFocus.x, y: scene.subjectZoomFocus.y },
		);
		setDirection('forward');
		setPhase(reduceMotion ? 'cutawayIdle' : 'bubbleFocus');
		notifyProgramTab(pathway.projectId);
		document
			.getElementById('lung-health-visual')
			?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
	}

	/**
	 * Reverses the cinematic transition back to the outdoor intake scene.
	 */
	function returnToOutdoor() {
		if (reduceMotion) {
			setPhase('outdoorIdle');
			setActiveId(null);
			setHoveredId(null);
			return;
		}
		setDirection('reverse');
		setPhase('cutawayReveal');
	}

	/** Prefetches the cutaway asset on hotspot hover intent. */
	function prefetchCutaway() {
		void fetch(cutaway.imageSrc).catch(() => undefined);
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

	const outdoorInitial = animatedPhase
		? getPhaseStartFrame(phase, direction, cameraConfig).outdoor
		: staticFrame.outdoor;

	const cutawayInitial = animatedPhase
		? getPhaseStartFrame(phase, direction, cameraConfig).cutaway
		: staticFrame.cutaway;

	const stageStyle = {
		aspectRatio: isCutawayStage ? cutawayAspect : outdoorAspect,
		backgroundColor: staticFrame.stageBackground,
	} as CSSProperties;

	const panelCard =
		phase === 'cutawayIdle' && activePathway ? (
			<div className="lhv__panel-card">
				<p className="lhv__panel-eyebrow">{activePathway.label}</p>
				<h2 className="lhv__panel-title">{activePathway.previewTitle}</h2>
				<p className="lhv__panel-question">{activePathway.previewQuestion}</p>
				<p className="lhv__panel-caption">{activePathway.caption}</p>
				<a className="lhv__panel-link" href={`#${activePathway.projectId}`}>
					View full program
				</a>
			</div>
		) : panelPathway ? (
			<div className="lhv__panel-card">
				<p className="lhv__panel-eyebrow">{panelPathway.label}</p>
				<h2 className="lhv__panel-title">{panelPathway.previewTitle}</h2>
				<p className="lhv__panel-question">{panelPathway.previewQuestion}</p>
				<p className="lhv__panel-cta">{panelPathway.previewCta}</p>
			</div>
		) : (
			<div className="lhv__panel-card">
				<p className="lhv__panel-eyebrow">Exposure pathway</p>
				<h2 className="lhv__panel-title">Select a pathway</h2>
				<p className="lhv__panel-caption">
					Hover a source to preview the related research program, then click to
					explore the airway cutaway.
				</p>
			</div>
		);

	const hotspotButtons = showHotspots
		? scene.hotspots.map((hotspot) => {
				const pathway = pathwayById(hotspot.id);
				const isActiveBubble = activeId === hotspot.id && phase === 'bubbleFocus';

				return (
					<button
						key={hotspot.id}
						type="button"
						className={
							isActiveBubble ? 'lhv__hotspot is-bubble-focus' : 'lhv__hotspot'
						}
						style={
							{
								'--lhv-x': `${hotspot.x}%`,
								'--lhv-y': `${hotspot.y}%`,
								'--lhv-size': `${hotspot.size}%`,
							} as CSSProperties
						}
						aria-label={`${pathway.label} exposure pathway`}
						onMouseEnter={() => {
							setHoveredId(hotspot.id);
							prefetchCutaway();
						}}
						onMouseLeave={() =>
							setHoveredId((current) => (current === hotspot.id ? null : current))
						}
						onFocus={() => {
							setHoveredId(hotspot.id);
							prefetchCutaway();
						}}
						onBlur={() =>
							setHoveredId((current) => (current === hotspot.id ? null : current))
						}
						onClick={() => selectPathway(hotspot.id)}
						onKeyDown={(event) => onHotspotKeyDown(event, hotspot.id)}
					>
						<span className="lhv__hotspot-ring" aria-hidden="true" />
					</button>
				);
			})
		: null;

	if (!motionReady) {
		return (
			<div className="lhv">
				<div className={isCutawayStage ? 'lhv__layout is-cutaway' : 'lhv__layout'}>
					<figure className="lhv__scene" aria-labelledby="lhv-scene-label">
						<span id="lhv-scene-label" className="sr-only">
							Interactive lung health exposure pathways
						</span>
						<div className="lhv__stage" style={stageStyle}>
							{(staticFrame.showCutaway || isCutawayStage) && (
								<div
									className="lhv__view lhv__view--cutaway"
									style={{
										opacity: staticFrame.cutaway.opacity,
										transform: `scale(${staticFrame.cutaway.scale})`,
										transformOrigin: `${staticFrame.cutaway.transformOriginXPercent}% ${staticFrame.cutaway.transformOriginYPercent}%`,
									}}
								>
									<LungHealthCutaway activePathwayId={activeId} />
								</div>
							)}
							{(staticFrame.showOutdoor || phase !== 'cutawayIdle') && (
								<div
									className="lhv__view lhv__view--outdoor"
									style={{
										opacity: staticFrame.outdoor.opacity,
										transform: `translate(${staticFrame.outdoor.translateXPercent}%, ${staticFrame.outdoor.translateYPercent}%) scale(${staticFrame.outdoor.scale})`,
										transformOrigin: `${staticFrame.outdoor.transformOriginXPercent}% ${staticFrame.outdoor.transformOriginYPercent}%`,
										filter: `saturate(${1 - staticFrame.outdoor.desaturate})`,
									}}
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
								</div>
							)}
							{showHotspots && (
								<div
									className="lhv__hotspots"
									role="group"
									aria-label="Exposure pathway hotspots"
									style={{
										pointerEvents: phase === 'outdoorIdle' ? 'auto' : 'none',
									}}
								>
									{hotspotButtons}
								</div>
							)}
						</div>
					</figure>
					<aside className="lhv__panel" aria-live="polite">
						{panelCard}
					</aside>
				</div>
			</div>
		);
	}

	return (
		<div className="lhv">
			<div className={isCutawayStage ? 'lhv__layout is-cutaway' : 'lhv__layout'}>
				<figure className="lhv__scene" aria-labelledby="lhv-scene-label">
					<span id="lhv-scene-label" className="sr-only">
						Interactive lung health exposure pathways
					</span>

					{phase === 'cutawayIdle' && (
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
						animate={{
							aspectRatio: isCutawayStage ? cutawayAspect : outdoorAspect,
							backgroundColor: animatedPhase
								? stageBackgroundKeyframes
								: staticFrame.stageBackground,
						}}
						transition={{
							aspectRatio: {
								duration: reduceMotion ? 0 : phase === 'portal' ? 0.45 : 0.35,
								ease: EASE_OUT,
							},
							backgroundColor: animatedPhase
								? {
										duration: phaseDuration,
										ease: 'linear',
										times: keyframeTimes(PHASE_SAMPLE_COUNT),
									}
								: { duration: reduceMotion ? 0 : 0.35 },
						}}
					>
						{(staticFrame.showCutaway || isCutawayStage) && (
							<motion.div
								key={`cutaway-${phase}-${direction}`}
								className="lhv__view lhv__view--cutaway"
								data-layer="cutaway"
								initial={
									animatedPhase
										? {
												opacity: cutawayInitial.opacity,
												scale: cutawayInitial.scale,
											}
										: false
								}
								animate={
									animatedPhase && cutawayKeyframes
										? {
												opacity: cutawayKeyframes.opacity,
												scale: cutawayKeyframes.scale,
											}
										: {
												opacity: staticFrame.cutaway.opacity,
												scale: staticFrame.cutaway.scale,
											}
								}
								transition={
									animatedPhase
										? {
												duration: phaseDuration,
												ease: 'linear',
												times: cutawayKeyframes?.times,
											}
										: { duration: 0 }
								}
								style={
									{
										transformOrigin: `${cutawayKeyframes?.originX ?? staticFrame.cutaway.transformOriginXPercent}% ${cutawayKeyframes?.originY ?? staticFrame.cutaway.transformOriginYPercent}%`,
										willChange: 'transform, opacity',
									} as CSSProperties
								}
							>
								<LungHealthCutaway activePathwayId={activeId} />
							</motion.div>
						)}

						{(staticFrame.showOutdoor || phase !== 'cutawayIdle') && (
							<motion.div
								key={`outdoor-${phase}-${direction}`}
								className="lhv__view lhv__view--outdoor"
								data-layer="outdoor"
								initial={
									animatedPhase
										? {
												opacity: outdoorInitial.opacity,
												scale: outdoorInitial.scale,
												x: `${outdoorInitial.translateXPercent}%`,
												y: `${outdoorInitial.translateYPercent}%`,
											}
										: false
								}
								animate={
									animatedPhase && outdoorAnim
										? {
												opacity: outdoorAnim.opacity,
												scale: outdoorAnim.scale,
												x: outdoorAnim.x,
												y: outdoorAnim.y,
											}
										: {
												opacity: staticFrame.outdoor.opacity,
												scale: staticFrame.outdoor.scale,
												x: `${staticFrame.outdoor.translateXPercent}%`,
												y: `${staticFrame.outdoor.translateYPercent}%`,
											}
								}
								transition={
									animatedPhase
										? {
												duration: phaseDuration,
												ease: 'linear',
												times: outdoorAnim?.times,
											}
										: { duration: 0 }
								}
								style={
									{
										transformOrigin: `${outdoorOrigin.x}% ${outdoorOrigin.y}%`,
										filter: `saturate(${1 - (outdoorAnim?.desaturate.at(-1) ?? staticFrame.outdoor.desaturate)})`,
										willChange: 'transform, opacity, filter',
									} as CSSProperties
								}
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
						)}

						{portalKeyframes &&
							(phase === 'portal' || phase === 'cutawayReveal') && (
							<motion.div
								key={`portal-wrap-${phase}-${direction}`}
								className="lhv__portal-wrap"
								initial={{ opacity: 0 }}
								animate={{
									opacity: portalKeyframes.opacity,
									'--lhv-portal-r': portalKeyframes.radius.map(
										(value) => `${value}%`,
									),
								}}
								transition={{
									duration: phaseDuration,
									ease: 'linear',
									times: portalKeyframes.times,
								}}
								style={
									{
										'--lhv-portal-x': `${portalKeyframes.centerX}%`,
										'--lhv-portal-y': `${portalKeyframes.centerY}%`,
										'--lhv-portal-bg': transition.backgroundCutaway,
									} as CSSProperties
								}
							>
								<LungHealthPortal
									centerXPercent={portalKeyframes.centerX}
									centerYPercent={portalKeyframes.centerY}
									opacity={1}
									backgroundColor={transition.backgroundCutaway}
								/>
							</motion.div>
						)}

						{showHotspots && (
							<div
								className="lhv__hotspots"
								role="group"
								aria-label="Exposure pathway hotspots"
								style={{
									pointerEvents: phase === 'outdoorIdle' ? 'auto' : 'none',
								}}
							>
								{hotspotButtons}
							</div>
						)}
					</motion.div>
				</figure>

				<aside className="lhv__panel" aria-live="polite">
					<AnimatePresence mode="wait">
						{phase === 'cutawayIdle' && activePathway ? (
							<motion.div
								key={`open-${activePathway.id}`}
								className="lhv__panel-card"
								initial={reduceMotion ? false : { opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
								transition={{ duration: 0.28, ease: EASE_OUT }}
							>
								<p className="lhv__panel-eyebrow">{activePathway.label}</p>
								<h2 className="lhv__panel-title">
									{activePathway.previewTitle}
								</h2>
								<p className="lhv__panel-question">
									{activePathway.previewQuestion}
								</p>
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
								<h2 className="lhv__panel-title">
									{panelPathway.previewTitle}
								</h2>
								<p className="lhv__panel-question">
									{panelPathway.previewQuestion}
								</p>
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
								<h2 className="lhv__panel-title">Select a pathway</h2>
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
