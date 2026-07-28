/**
 * Pure camera math for the lung-health cinematic transition.
 * Maps phased progress to transform, mask, and background values — no React.
 */

import type {
	LungHealthFocusPoint,
	LungHealthPhaseDurations,
	LungHealthTransitionArc,
} from '../data/lungHealthVisual';

/** Discrete phases in the outdoor → cutaway transition state machine. */
export type LungHealthTransitionPhase =
	| 'outdoorIdle'
	| 'bubbleFocus'
	| 'travel'
	| 'portal'
	| 'cutawayReveal'
	| 'cutawayIdle';

/** Playback direction for forward entry or reverse exit. */
export type LungHealthTransitionDirection = 'forward' | 'reverse';

/** 2D point in percentage or viewBox space. */
export interface LungHealthPoint2D {
	x: number;
	y: number;
}

/** Cutaway coordinate system from Project 2 generated metadata. */
export interface LungHealthCutawayGeometry {
	viewBox: { width: number; height: number };
	entryAnchor: LungHealthPoint2D;
}

/** Camera parameters supplied by data config and active hotspot. */
export interface LungHealthCameraConfig {
	bubbleFocus: LungHealthFocusPoint;
	portalFocus: LungHealthFocusPoint;
	cutawayGeometry: LungHealthCutawayGeometry;
	arc: LungHealthTransitionArc;
	phases: LungHealthPhaseDurations;
	outdoorZoomScale: number;
	bubbleFocusScale: number;
	cutawayRevealStartScale: number;
	portalStartRadiusPercent: number;
	portalMaxRadiusPercent: number;
	backgroundOutdoor: string;
	backgroundCutaway: string;
}

/** Sampled frame values consumed by LungHealthVisual layers. */
export interface LungHealthCameraFrame {
	outdoor: {
		scale: number;
		translateXPercent: number;
		translateYPercent: number;
		opacity: number;
		desaturate: number;
		transformOriginXPercent: number;
		transformOriginYPercent: number;
	};
	portal: {
		centerXPercent: number;
		centerYPercent: number;
		maskRadiusPercent: number;
		opacity: number;
	};
	cutaway: {
		scale: number;
		opacity: number;
		transformOriginXPercent: number;
		transformOriginYPercent: number;
	};
	stageBackground: string;
	showOutdoor: boolean;
	showCutaway: boolean;
	showPortal: boolean;
}

/** Ordered forward phases excluding idle states. */
export const LUNG_HEALTH_FORWARD_PHASES: readonly Exclude<
	LungHealthTransitionPhase,
	'outdoorIdle' | 'cutawayIdle'
>[] = ['bubbleFocus', 'travel', 'portal', 'cutawayReveal'];

const PHASE_ORDER: readonly LungHealthTransitionPhase[] = [
	'outdoorIdle',
	'bubbleFocus',
	'travel',
	'portal',
	'cutawayReveal',
	'cutawayIdle',
];

/**
 * Clamps a value to the inclusive range [0, 1].
 * @param value - Raw progress
 */
function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Smoothstep ease for bubble focus and cutaway settle.
 * @param t - Normalized progress from 0 to 1
 */
function easeInOutCubic(t: number): number {
	const clamped = clamp01(t);
	return clamped < 0.5
		? 4 * clamped * clamped * clamped
		: 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Ease-in cubic for travel acceleration into the nose portal.
 * @param t - Normalized progress from 0 to 1
 */
function easeInCubic(t: number): number {
	const clamped = clamp01(t);
	return clamped * clamped * clamped;
}

/**
 * Ease-out cubic for portal expansion and reverse travel.
 * @param t - Normalized progress from 0 to 1
 */
function easeOutCubic(t: number): number {
	const clamped = clamp01(t);
	return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Samples a quadratic bezier along one axis.
 * @param t - Progress from 0 to 1
 * @param start - Path start
 * @param control - Control point
 * @param end - Path end
 */
function sampleQuadraticBezier(
	t: number,
	start: number,
	control: number,
	end: number,
): number {
	const u = 1 - t;
	return u * u * start + 2 * u * t * control + t * t * end;
}

/**
 * Linearly interpolates between two numbers.
 * @param from - Start value
 * @param to - End value
 * @param t - Blend factor from 0 to 1
 */
function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

/**
 * Parses a hex color (#rrggbb) into RGB channels.
 * @param hex - Six-digit hex color
 */
function parseHexColor(hex: string): [number, number, number] {
	const normalized = hex.replace('#', '');
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return [r, g, b];
}

/**
 * Interpolates between two hex colors.
 * @param from - Start hex color
 * @param to - End hex color
 * @param t - Blend factor from 0 to 1
 */
function interpolateHexColor(from: string, to: string, t: number): string {
	const [r0, g0, b0] = parseHexColor(from);
	const [r1, g1, b1] = parseHexColor(to);
	const blend = clamp01(t);
	const r = Math.round(lerp(r0, r1, blend));
	const g = Math.round(lerp(g0, g1, blend));
	const b = Math.round(lerp(b0, b1, blend));
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Converts a cutaway viewBox anchor to percentage transform-origin.
 * @param anchor - Point in viewBox coordinates
 * @param viewBox - Cutaway viewBox dimensions
 */
export function cutawayAnchorToPercent(
	anchor: LungHealthPoint2D,
	viewBox: { width: number; height: number },
): LungHealthPoint2D {
	return {
		x: (anchor.x / viewBox.width) * 100,
		y: (anchor.y / viewBox.height) * 100,
	};
}

/**
 * Returns the duration in seconds for a single transition phase.
 * @param phase - Transition phase
 * @param phases - Phase duration config
 */
export function getPhaseDurationSec(
	phase: LungHealthTransitionPhase,
	phases: LungHealthPhaseDurations,
): number {
	switch (phase) {
		case 'bubbleFocus':
			return phases.bubbleFocusSec;
		case 'travel':
			return phases.travelSec;
		case 'portal':
			return phases.portalSec;
		case 'cutawayReveal':
			return phases.cutawayRevealSec;
		default:
			return 0;
	}
}

/**
 * Sums all animated phase durations.
 * @param phases - Phase duration config
 */
export function getTotalTransitionDurationSec(
	phases: LungHealthPhaseDurations,
): number {
	return (
		phases.bubbleFocusSec +
		phases.travelSec +
		phases.portalSec +
		phases.cutawayRevealSec
	);
}

/**
 * Returns the next phase when playing forward or reverse.
 * @param phase - Current phase
 * @param direction - Playback direction
 */
export function getAdjacentPhase(
	phase: LungHealthTransitionPhase,
	direction: LungHealthTransitionDirection,
): LungHealthTransitionPhase {
	const index = PHASE_ORDER.indexOf(phase);
	if (direction === 'forward') {
		return PHASE_ORDER[Math.min(index + 1, PHASE_ORDER.length - 1)];
	}
	return PHASE_ORDER[Math.max(index - 1, 0)];
}

/**
 * Applies phase-specific easing for forward or reverse playback.
 * @param phase - Active phase
 * @param direction - Playback direction
 * @param t - Linear progress within the phase
 */
function applyPhaseEasing(
	phase: LungHealthTransitionPhase,
	direction: LungHealthTransitionDirection,
	t: number,
): number {
	const linear = direction === 'forward' ? t : 1 - t;

	switch (phase) {
		case 'bubbleFocus':
			return easeInOutCubic(linear);
		case 'travel':
			return direction === 'forward' ? easeInCubic(linear) : easeOutCubic(linear);
		case 'portal':
			return easeOutCubic(linear);
		case 'cutawayReveal':
			return easeInOutCubic(linear);
		default:
			return linear;
	}
}

/**
 * Builds the bezier control point between bubble and nose portal.
 * @param bubble - Hotspot center in outdoor %
 * @param portal - Nose portal in outdoor %
 * @param arc - Arc drift config
 */
function travelControlPoint(
	bubble: LungHealthFocusPoint,
	portal: LungHealthFocusPoint,
	arc: LungHealthTransitionArc,
): LungHealthPoint2D {
	return {
		x: (bubble.x + portal.x) / 2 + arc.midX,
		y: (bubble.y + portal.y) / 2 + arc.midY,
	};
}

/**
 * Samples the camera frame at a given phase and normalized progress (0–1).
 * @param phase - Active transition phase
 * @param phaseProgress - Linear progress within the phase (0–1)
 * @param direction - Forward entry or reverse exit
 * @param config - Camera parameters from data + active hotspot
 */
export function sampleCameraFrame(
	phase: LungHealthTransitionPhase,
	phaseProgress: number,
	direction: LungHealthTransitionDirection,
	config: LungHealthCameraConfig,
): LungHealthCameraFrame {
	const t = applyPhaseEasing(phase, direction, clamp01(phaseProgress));
	const {
		bubbleFocus,
		portalFocus,
		cutawayGeometry,
		arc,
		outdoorZoomScale,
		bubbleFocusScale,
		cutawayRevealStartScale,
		portalStartRadiusPercent,
		portalMaxRadiusPercent,
		backgroundOutdoor,
		backgroundCutaway,
	} = config;

	const cutawayOrigin = cutawayAnchorToPercent(
		cutawayGeometry.entryAnchor,
		cutawayGeometry.viewBox,
	);

	const travelControl = travelControlPoint(bubbleFocus, portalFocus, arc);
	const travelEndX = arc.endX;
	const travelEndY = arc.endY;

	const idleOutdoor: LungHealthCameraFrame = {
		outdoor: {
			scale: 1,
			translateXPercent: 0,
			translateYPercent: 0,
			opacity: 1,
			desaturate: 0,
			transformOriginXPercent: 50,
			transformOriginYPercent: 50,
		},
		portal: {
			centerXPercent: portalFocus.x,
			centerYPercent: portalFocus.y,
			maskRadiusPercent: portalStartRadiusPercent,
			opacity: 0,
		},
		cutaway: {
			scale: 1,
			opacity: 0,
			transformOriginXPercent: cutawayOrigin.x,
			transformOriginYPercent: cutawayOrigin.y,
		},
		stageBackground: backgroundOutdoor,
		showOutdoor: true,
		showCutaway: false,
		showPortal: false,
	};

	const idleCutaway: LungHealthCameraFrame = {
		outdoor: {
			scale: outdoorZoomScale,
			translateXPercent: travelEndX,
			translateYPercent: travelEndY,
			opacity: 0,
			desaturate: 0.35,
			transformOriginXPercent: portalFocus.x,
			transformOriginYPercent: portalFocus.y,
		},
		portal: {
			centerXPercent: portalFocus.x,
			centerYPercent: portalFocus.y,
			maskRadiusPercent: portalMaxRadiusPercent,
			opacity: 0,
		},
		cutaway: {
			scale: 1,
			opacity: 1,
			transformOriginXPercent: cutawayOrigin.x,
			transformOriginYPercent: cutawayOrigin.y,
		},
		stageBackground: backgroundCutaway,
		showOutdoor: false,
		showCutaway: true,
		showPortal: false,
	};

	if (phase === 'outdoorIdle') {
		return idleOutdoor;
	}

	if (phase === 'cutawayIdle') {
		return idleCutaway;
	}

	if (phase === 'bubbleFocus') {
		return {
			...idleOutdoor,
			outdoor: {
				scale: lerp(1, bubbleFocusScale, t),
				translateXPercent: lerp(0, (50 - bubbleFocus.x) * 0.08, t),
				translateYPercent: lerp(0, (50 - bubbleFocus.y) * 0.08, t),
				opacity: 1,
				desaturate: lerp(0, 0.25, t),
				transformOriginXPercent: lerp(50, bubbleFocus.x, t),
				transformOriginYPercent: lerp(50, bubbleFocus.y, t),
			},
			showOutdoor: true,
			showCutaway: false,
			showPortal: false,
		};
	}

	if (phase === 'travel') {
		const bubbleEndX = (50 - bubbleFocus.x) * 0.08;
		const bubbleEndY = (50 - bubbleFocus.y) * 0.08;
		const controlX = (50 - travelControl.x) * 0.08;
		const controlY = (50 - travelControl.y) * 0.08;
		const translateX = sampleQuadraticBezier(
			t,
			bubbleEndX,
			controlX,
			travelEndX,
		);
		const translateY = sampleQuadraticBezier(
			t,
			bubbleEndY,
			controlY,
			travelEndY,
		);
		const originX = lerp(bubbleFocus.x, portalFocus.x, t);
		const originY = lerp(bubbleFocus.y, portalFocus.y, t);

		return {
			...idleOutdoor,
			outdoor: {
				scale: lerp(bubbleFocusScale, outdoorZoomScale, t),
				translateXPercent: translateX,
				translateYPercent: translateY,
				opacity: 1,
				desaturate: lerp(0.25, 0.35, t),
				transformOriginXPercent: originX,
				transformOriginYPercent: originY,
			},
			showOutdoor: true,
			showCutaway: false,
			showPortal: false,
		};
	}

	if (phase === 'portal') {
		const maskRadius = lerp(portalStartRadiusPercent, portalMaxRadiusPercent, t);
		const outdoorOpacity = lerp(1, 0, t);

		return {
			outdoor: {
				scale: outdoorZoomScale,
				translateXPercent: travelEndX,
				translateYPercent: travelEndY,
				opacity: outdoorOpacity,
				desaturate: 0.35,
				transformOriginXPercent: portalFocus.x,
				transformOriginYPercent: portalFocus.y,
			},
			portal: {
				centerXPercent: portalFocus.x,
				centerYPercent: portalFocus.y,
				maskRadiusPercent: maskRadius,
				opacity: lerp(0, 1, Math.min(1, t * 1.4)),
			},
			cutaway: {
				scale: cutawayRevealStartScale,
				opacity: lerp(0, 0.85, t),
				transformOriginXPercent: cutawayOrigin.x,
				transformOriginYPercent: cutawayOrigin.y,
			},
			stageBackground: interpolateHexColor(
				backgroundOutdoor,
				backgroundCutaway,
				t,
			),
			showOutdoor: true,
			showCutaway: true,
			showPortal: true,
		};
	}

	// cutawayReveal
	return {
		outdoor: {
			scale: outdoorZoomScale,
			translateXPercent: travelEndX,
			translateYPercent: travelEndY,
			opacity: lerp(0.2, 0, t),
			desaturate: 0.35,
			transformOriginXPercent: portalFocus.x,
			transformOriginYPercent: portalFocus.y,
		},
		portal: {
			centerXPercent: portalFocus.x,
			centerYPercent: portalFocus.y,
			maskRadiusPercent: portalMaxRadiusPercent,
			opacity: lerp(1, 0, t),
		},
		cutaway: {
			scale: lerp(cutawayRevealStartScale, 1, t),
			opacity: lerp(0.85, 1, t),
			transformOriginXPercent: cutawayOrigin.x,
			transformOriginYPercent: cutawayOrigin.y,
		},
		stageBackground: backgroundCutaway,
		showOutdoor: t < 0.95,
		showCutaway: true,
		showPortal: t < 0.85,
	};
}

/**
 * Returns the camera frame at the start boundary of a phase (progress 0).
 * @param phase - Transition phase
 * @param direction - Playback direction
 * @param config - Camera parameters
 */
export function getPhaseStartFrame(
	phase: LungHealthTransitionPhase,
	direction: LungHealthTransitionDirection,
	config: LungHealthCameraConfig,
): LungHealthCameraFrame {
	return sampleCameraFrame(phase, direction === 'forward' ? 0 : 1, direction, config);
}

/**
 * Returns the camera frame at the end boundary of a phase (progress 1).
 * @param phase - Transition phase
 * @param direction - Playback direction
 * @param config - Camera parameters
 */
export function getPhaseEndFrame(
	phase: LungHealthTransitionPhase,
	direction: LungHealthTransitionDirection,
	config: LungHealthCameraConfig,
): LungHealthCameraFrame {
	return sampleCameraFrame(phase, direction === 'forward' ? 1 : 0, direction, config);
}
