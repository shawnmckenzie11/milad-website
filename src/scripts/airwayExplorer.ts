import {
	airwayScene,
	getConnectedEdgeIds,
	getSceneNode,
	isContextNode,
	parseViewBox,
	viewBoxToString,
	type SceneViewBox,
} from '../data/airwayScene';

/** Presentation fields used to hydrate the detail chip for linked programs. */
export interface ExplorerPresentation {
	shortLabel: string;
	question: string;
}

/** Options passed from AirwayExplorer.astro when mounting the map. */
export interface AirwayExplorerOptions {
	/** Map of projectId → chip copy from projectPresentation. */
	presentations: Record<string, ExplorerPresentation>;
}

/** Internal pan/zoom camera state derived from the SVG viewBox. */
interface CameraState {
	viewBox: SceneViewBox;
	/** Scale relative to the overview width (1 = overview). */
	scale: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 3.5;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const FOCUS_DURATION_MS = 280;

/**
 * Returns whether the user prefers reduced motion.
 */
function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Clamps a numeric value into an inclusive range.
 * @param value - Input number
 * @param min - Lower bound
 * @param max - Upper bound
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Clamps a viewBox so it stays within the overview canvas bounds.
 * @param viewBox - Candidate viewBox
 * @param overview - Full-scene overview viewBox
 */
function clampViewBox(viewBox: SceneViewBox, overview: SceneViewBox): SceneViewBox {
	const width = clamp(viewBox.width, overview.width / MAX_SCALE, overview.width / MIN_SCALE);
	const height = width * (overview.height / overview.width);
	const maxX = overview.x + overview.width - width;
	const maxY = overview.y + overview.height - height;
	return {
		x: clamp(viewBox.x, overview.x, Math.max(overview.x, maxX)),
		y: clamp(viewBox.y, overview.y, Math.max(overview.y, maxY)),
		width,
		height,
	};
}

/**
 * Interpolates between two viewBoxes.
 * @param from - Start viewBox
 * @param to - End viewBox
 * @param t - Progress from 0 to 1
 */
function lerpViewBox(from: SceneViewBox, to: SceneViewBox, t: number): SceneViewBox {
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
		width: from.width + (to.width - from.width) * t,
		height: from.height + (to.height - from.height) * t,
	};
}

/**
 * Ease-out cubic for focus transitions when motion is allowed.
 * @param t - Linear progress from 0 to 1
 */
function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/**
 * Converts a client-space pointer position into SVG scene coordinates.
 * @param svg - Root SVG element
 * @param clientX - Pointer X in viewport coordinates
 * @param clientY - Pointer Y in viewport coordinates
 * @param viewBox - Current camera viewBox
 */
function clientToScene(
	svg: SVGSVGElement,
	clientX: number,
	clientY: number,
	viewBox: SceneViewBox,
): { x: number; y: number } {
	const rect = svg.getBoundingClientRect();
	const x = viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width;
	const y = viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height;
	return { x, y };
}

/**
 * Builds a viewBox centered on a scene point at the requested scale.
 * @param overview - Overview viewBox
 * @param centerX - Scene X to keep under the pointer/center
 * @param centerY - Scene Y to keep under the pointer/center
 * @param scale - Zoom scale relative to overview (1 = full scene)
 */
function viewBoxAtScale(
	overview: SceneViewBox,
	centerX: number,
	centerY: number,
	scale: number,
): SceneViewBox {
	const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
	const width = overview.width / nextScale;
	const height = overview.height / nextScale;
	return clampViewBox(
		{
			x: centerX - width / 2,
			y: centerY - height / 2,
			width,
			height,
		},
		overview,
	);
}

/**
 * Zooms the camera toward a scene point while keeping that point stable on screen.
 * @param current - Current viewBox
 * @param overview - Overview viewBox
 * @param sceneX - Anchor X in scene units
 * @param sceneY - Anchor Y in scene units
 * @param nextScale - Target scale relative to overview
 */
function zoomAboutPoint(
	current: SceneViewBox,
	overview: SceneViewBox,
	sceneX: number,
	sceneY: number,
	nextScale: number,
): SceneViewBox {
	const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
	const width = overview.width / scale;
	const height = overview.height / scale;
	const relX = (sceneX - current.x) / current.width;
	const relY = (sceneY - current.y) / current.height;
	return clampViewBox(
		{
			x: sceneX - relX * width,
			y: sceneY - relY * height,
			width,
			height,
		},
		overview,
	);
}

/**
 * Initializes pan/zoom, hotspot selection, and detail-chip wiring for one explorer root.
 * @param root - Element with `data-airway-explorer`
 * @param options - Presentation copy for linked program chips
 */
export function initAirwayExplorer(root: HTMLElement, options: AirwayExplorerOptions): void {
	const viewport = root.querySelector<HTMLElement>('[data-explorer-viewport]');
	const svgHost = root.querySelector<HTMLElement>('[data-explorer-svg]');
	const chip = root.querySelector<HTMLElement>('[data-explorer-chip]');
	const chipLabel = root.querySelector<HTMLElement>('[data-explorer-chip-label]');
	const chipQuestion = root.querySelector<HTMLElement>('[data-explorer-chip-question]');
	const chipLink = root.querySelector<HTMLAnchorElement>('[data-explorer-chip-link]');
	const liveRegion = root.querySelector<HTMLElement>('[data-explorer-live]');
	const zoomInBtn = root.querySelector<HTMLButtonElement>('[data-explorer-zoom-in]');
	const zoomOutBtn = root.querySelector<HTMLButtonElement>('[data-explorer-zoom-out]');
	const resetBtn = root.querySelector<HTMLButtonElement>('[data-explorer-reset]');

	if (!viewport || !svgHost) return;

	const svg = svgHost.querySelector('svg');
	if (!(svg instanceof SVGSVGElement)) return;

	const overview = airwayScene.overviewViewBox;
	let camera: CameraState = {
		viewBox: { ...overview },
		scale: 1,
	};
	let selectedNodeId: string | null = null;
	let rafId = 0;
	let isPointerDown = false;
	let isPanning = false;
	let pointerId: number | null = null;
	let lastClientX = 0;
	let lastClientY = 0;

	/**
	 * Applies a viewBox to the SVG and updates derived camera scale.
	 * @param viewBox - ViewBox to apply
	 */
	function setViewBox(viewBox: SceneViewBox): void {
		const next = clampViewBox(viewBox, overview);
		camera = {
			viewBox: next,
			scale: overview.width / next.width,
		};
		svg!.setAttribute('viewBox', viewBoxToString(next));
		root.dataset.zoomScale = camera.scale.toFixed(2);
		updateEdgeLabelVisibility();
	}

	/**
	 * Animates (or instantly jumps) the camera to a target viewBox.
	 * @param target - Destination viewBox
	 */
	function focusViewBox(target: SceneViewBox): void {
		const clamped = clampViewBox(target, overview);
		if (prefersReducedMotion()) {
			setViewBox(clamped);
			return;
		}

		const from = { ...camera.viewBox };
		const start = performance.now();
		if (rafId) cancelAnimationFrame(rafId);

		/**
		 * Steps one frame of the focus easing animation.
		 * @param now - performance.now() timestamp
		 */
		function tick(now: number): void {
			const t = clamp((now - start) / FOCUS_DURATION_MS, 0, 1);
			setViewBox(lerpViewBox(from, clamped, easeOutCubic(t)));
			if (t < 1) {
				rafId = requestAnimationFrame(tick);
			} else {
				rafId = 0;
			}
		}

		rafId = requestAnimationFrame(tick);
	}

	/**
	 * Shows edge labels only when zoomed in far enough to read them.
	 */
	function updateEdgeLabelVisibility(): void {
		const showLabels = camera.scale >= 1.35;
		root.dataset.edgeLabels = showLabels ? 'visible' : 'hidden';
		for (const label of svg!.querySelectorAll('.edge-label')) {
			label.setAttribute('opacity', showLabels ? '1' : '0');
		}
	}

	/**
	 * Clears hotspot/edge selection classes on the SVG.
	 */
	function clearHighlights(): void {
		for (const el of svg!.querySelectorAll('.hotspot.is-selected, .edge.is-active')) {
			el.classList.remove('is-selected', 'is-active');
		}
	}

	/**
	 * Highlights a node and its connected edges.
	 * @param nodeId - Scene node id to emphasize
	 */
	function highlightNode(nodeId: string): void {
		clearHighlights();
		const hotspot = svg!.querySelector(`[data-node-id="${nodeId}"]`);
		hotspot?.classList.add('is-selected');
		for (const edgeId of getConnectedEdgeIds(nodeId)) {
			svg!.querySelector(`[data-edge-id="${edgeId}"]`)?.classList.add('is-active');
		}
	}

	/**
	 * Hides the detail chip and clears its link target.
	 */
	function hideChip(): void {
		if (!chip) return;
		chip.hidden = true;
		chip.setAttribute('aria-hidden', 'true');
		delete chip.dataset.emphasis;
		delete chip.dataset.context;
		if (chipLink) {
			chipLink.hidden = true;
			chipLink.removeAttribute('href');
			chipLink.removeAttribute('aria-label');
		}
	}

	/**
	 * Populates and reveals the detail chip for a selected node.
	 * Context INs (no projectId) show summary only—never a false “View program” CTA.
	 * @param nodeId - Selected scene node id
	 */
	function showChip(nodeId: string): void {
		const node = getSceneNode(nodeId);
		if (!node || !chip || !chipLabel || !chipQuestion) return;

		const presentation = node.projectId ? options.presentations[node.projectId] : undefined;
		chipLabel.textContent = presentation?.shortLabel ?? node.label;
		chipQuestion.textContent = presentation?.question ?? node.summary;
		chip.dataset.emphasis = node.emphasis;
		if (isContextNode(nodeId)) {
			chip.dataset.context = 'true';
		} else {
			delete chip.dataset.context;
		}

		if (chipLink) {
			if (node.projectId) {
				chipLink.hidden = false;
				chipLink.href = `#${node.projectId}`;
				chipLink.setAttribute('aria-label', `View program: ${chipLabel.textContent}`);
			} else {
				chipLink.hidden = true;
				chipLink.removeAttribute('href');
				chipLink.removeAttribute('aria-label');
			}
		}

		chip.hidden = false;
		chip.setAttribute('aria-hidden', 'false');
	}

	/**
	 * Announces the current selection to assistive technology.
	 * @param message - Live region text
	 */
	function announce(message: string): void {
		if (liveRegion) liveRegion.textContent = message;
	}

	/**
	 * Selects a hotspot: focus camera, highlight, and update the detail chip.
	 * @param nodeId - Scene node id
	 */
	function selectNode(nodeId: string): void {
		const node = getSceneNode(nodeId);
		if (!node) return;

		selectedNodeId = nodeId;
		root.dataset.selectedNode = nodeId;
		highlightNode(nodeId);
		focusViewBox(node.focusViewBox);
		showChip(nodeId);
		announce(`Selected ${node.label}.`);
	}

	/**
	 * Clears selection and returns the camera to the overview framing.
	 */
	function resetView(): void {
		selectedNodeId = null;
		delete root.dataset.selectedNode;
		clearHighlights();
		hideChip();
		focusViewBox(overview);
		announce('Map reset to overview.');
	}

	/**
	 * Zooms in or out about the viewport center (or a provided scene point).
	 * @param direction - `in` multiplies scale; `out` divides
	 * @param scenePoint - Optional zoom anchor in scene coordinates
	 */
	function zoomByStep(
		direction: 'in' | 'out',
		scenePoint?: { x: number; y: number },
	): void {
		const factor = direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP;
		const nextScale = camera.scale * factor;
		const center = scenePoint ?? {
			x: camera.viewBox.x + camera.viewBox.width / 2,
			y: camera.viewBox.y + camera.viewBox.height / 2,
		};
		setViewBox(zoomAboutPoint(camera.viewBox, overview, center.x, center.y, nextScale));
	}

	/**
	 * Scrolls the page to a ProjectCard by id when the chip link is activated.
	 * @param projectId - Element id of the target program article
	 */
	function scrollToProgram(projectId: string): void {
		const target = document.getElementById(projectId);
		if (!target) return;
		target.scrollIntoView({
			behavior: prefersReducedMotion() ? 'auto' : 'smooth',
			block: 'start',
		});
		if (target instanceof HTMLElement) {
			target.focus({ preventScroll: true });
		}
	}

	// Initial framing from the authored overview (or current attribute).
	const initial = parseViewBox(svg.getAttribute('viewBox') ?? '') ?? overview;
	setViewBox(initial);
	hideChip();

	for (const hotspot of svg.querySelectorAll<SVGGElement>('.hotspot[data-node-id]')) {
		hotspot.style.cursor = 'pointer';

		hotspot.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const nodeId = hotspot.dataset.nodeId;
			if (nodeId) selectNode(nodeId);
		});

		hotspot.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			const nodeId = hotspot.dataset.nodeId;
			if (nodeId) selectNode(nodeId);
		});
	}

	zoomInBtn?.addEventListener('click', () => zoomByStep('in'));
	zoomOutBtn?.addEventListener('click', () => zoomByStep('out'));
	resetBtn?.addEventListener('click', () => resetView());

	chipLink?.addEventListener('click', (event) => {
		const href = chipLink.getAttribute('href');
		if (!href?.startsWith('#')) return;
		event.preventDefault();
		scrollToProgram(href.slice(1));
	});

	viewport.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			const point = clientToScene(svg, event.clientX, event.clientY, camera.viewBox);
			const nextScale = camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
			setViewBox(zoomAboutPoint(camera.viewBox, overview, point.x, point.y, nextScale));
		},
		{ passive: false },
	);

	viewport.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		const target = event.target;
		if (target instanceof Element && target.closest('.hotspot')) {
			// Allow hotspot click without starting a pan.
			return;
		}
		isPointerDown = true;
		isPanning = false;
		pointerId = event.pointerId;
		lastClientX = event.clientX;
		lastClientY = event.clientY;
		viewport.setPointerCapture(event.pointerId);
		viewport.classList.add('is-panning');
	});

	viewport.addEventListener('pointermove', (event) => {
		if (!isPointerDown || pointerId !== event.pointerId) return;
		const rect = svg.getBoundingClientRect();
		const dx = ((event.clientX - lastClientX) / rect.width) * camera.viewBox.width;
		const dy = ((event.clientY - lastClientY) / rect.height) * camera.viewBox.height;
		if (!isPanning && Math.hypot(event.clientX - lastClientX, event.clientY - lastClientY) > 3) {
			isPanning = true;
		}
		if (isPanning) {
			setViewBox({
				...camera.viewBox,
				x: camera.viewBox.x - dx,
				y: camera.viewBox.y - dy,
			});
		}
		lastClientX = event.clientX;
		lastClientY = event.clientY;
	});

	/**
	 * Ends an active pan gesture and releases pointer capture.
	 * @param event - Pointer event that finished the gesture
	 */
	function endPan(event: PointerEvent): void {
		if (pointerId !== event.pointerId) return;
		isPointerDown = false;
		isPanning = false;
		pointerId = null;
		viewport.classList.remove('is-panning');
		if (viewport.hasPointerCapture(event.pointerId)) {
			viewport.releasePointerCapture(event.pointerId);
		}
	}

	viewport.addEventListener('pointerup', endPan);
	viewport.addEventListener('pointercancel', endPan);

	viewport.addEventListener('dblclick', (event) => {
		const point = clientToScene(svg, event.clientX, event.clientY, camera.viewBox);
		setViewBox(viewBoxAtScale(overview, point.x, point.y, Math.min(MAX_SCALE, camera.scale * ZOOM_STEP)));
	});

	root.addEventListener('keydown', (event) => {
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

		if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			zoomByStep('in');
		} else if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			zoomByStep('out');
		} else if (event.key === '0') {
			event.preventDefault();
			resetView();
		} else if (event.key === 'Escape' && selectedNodeId) {
			event.preventDefault();
			resetView();
		}
	});
}

/**
 * Mounts every `[data-airway-explorer]` on the page using JSON options from `data-explorer-options`.
 */
export function mountAirwayExplorers(): void {
	const roots = document.querySelectorAll<HTMLElement>('[data-airway-explorer]');
	for (const root of roots) {
		if (root.dataset.explorerReady === 'true') continue;
		let presentations: Record<string, ExplorerPresentation> = {};
		const raw = root.dataset.explorerOptions;
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as AirwayExplorerOptions;
				presentations = parsed.presentations ?? {};
			} catch {
				presentations = {};
			}
		}
		initAirwayExplorer(root, { presentations });
		root.dataset.explorerReady = 'true';
	}
}
