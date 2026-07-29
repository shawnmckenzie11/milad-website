import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	createNewAnalysis,
	deleteAnalysis,
	deleteDatabaseRow,
	fetchItems,
	fetchState,
	goHome,
	openAnalysis,
	renameAnalysis,
	saveAnnotation,
	saveAllClassifications,
	saveRlFeedback,
	saveTrainingFeedback,
	setSessionPhase,
	setStyleGuideProfile,
	saveStyleGuideProfile,
	saveStyleGuideProfileAsNew,
	setTierGate,
	saveSessionUiState,
	startExtract,
	startMatch,
	uploadAnalysisImages,
	uploadAssets,
	waitForJob,
	assetUrl,
} from './api';
import { ClassifyWizard } from './components/ClassifyWizard';
import { CutawayViewer, type SelectedFinding } from './components/CutawayViewer';
import {
	DatabasePipelinePage,
	rowIsDeletable,
	useDatabaseViewModel,
	type DatabaseMatchRow,
} from './components/DatabasePipelinePage';
import { FindingDetail } from './components/FindingDetail';
import {
	FreehandClassifyForm,
	type FreehandClassifyPayload,
} from './components/FreehandClassifyForm';
import { FreehandCloseEditor } from './components/FreehandCloseEditor';
import { ImageViewPanel } from './components/ImageViewPanel';
import { LegendViewPage } from './components/LegendViewPage';
import { FeedbackPromptModal } from './components/FeedbackPromptModal';
import { SessionHome } from './components/SessionHome';
import { SideTabs } from './components/SideTabs';
import {
	atlasSmoothClosedOutline,
	cleanFreehandOutline,
	extractGlyphContour,
	refineFreehandOutline,
	renderFreehandLegendIcon,
} from './lib/freehandGeometry';
import { DEFAULT_CUTAWAY_SIZE } from './lib/cutawaySize';
import {
	seedKnownTierAfterTier1,
	seedKnownTierAfterTier2,
} from './lib/knownClassification';
import { itemsWithoutPurgedHits } from './lib/purgedHits';
import { pathwayLayersFromProfile, pathwaysForLegendItem } from './lib/styleGuideLayers';
import { advanceRlCursor, buildRlFeedbackSummary } from './lib/rlFeedback';
import { computeTierProgress } from './lib/tierProgress';
import type {
	Annotation,
	EditMode,
	FindingsDb,
	JobState,
	LabState,
	LegendItemRow,
	LocationTallyKind,
	RefineScreen,
	RlFeedbackCursor,
	RlFeedbackSummary,
	TierProgressSnapshot,
	TracePoint,
	TrainingFeedback,
} from './types';

/** Options accepted by the bootstrap reload. */
type ReloadOptions = {
	/**
	 * Bump the asset cache-bust token. Only pass this after a step that rewrote
	 * image bytes (upload, extract, match, freehand icon) — every bump re-requests
	 * the cutaway, outlines, and every legend glyph, which reads as a flicker.
	 */
	bustAssets?: boolean;
};

/**
 * Identity of the images the asset routes will serve for this session.
 * A change here means the cache-bust token has to move (different analysis, or
 * an image appeared / disappeared); an unchanged signature means the currently
 * rendered `<img>` sources are still correct and must be left alone.
 *
 * @param state - Freshly fetched bootstrap state
 * @returns Comparable signature string
 */
function assetSignature(state: LabState): string {
	const s = state.session;
	return [
		s.analysisId ?? '',
		s.cutawayPath,
		s.legendPath,
		s.cutawayExists ? '1' : '0',
		s.legendExists ? '1' : '0',
	].join('|');
}

/**
 * Whether a cold start should land on the analyses home instead of resuming the
 * persisted screen. Only an empty wizard draft is skipped: with no images (or no
 * extracted legend rows) there is nothing to resume, and dropping the maintainer
 * straight into a half-created analysis hides the analysis list behind it.
 * Real in-progress work (extracted classify sessions, refine sessions) resumes.
 *
 * @param state - Bootstrap state from the server
 * @param itemCount - Legend rows currently extracted
 * @returns True when the boot should redirect to home
 */
function bootShouldLandOnHome(state: LabState, itemCount: number): boolean {
	if (state.session.screen !== 'classify') return false;
	return !state.session.cutawayExists || !state.session.legendExists || itemCount === 0;
}

/**
 * Root maintainer app: home → classify wizard → refine (Image | Database | Legend).
 */
export default function App() {
	const [state, setState] = useState<LabState | null>(null);
	const [items, setItems] = useState<LegendItemRow[]>([]);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const [selectedFinding, setSelectedFinding] = useState<SelectedFinding | null>(null);
	const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
	const [viewPathwayIds, setViewPathwayIds] = useState<string[]>([]);
	/** null = all legend codes visible; [] = none; otherwise listed codes only. */
	const [viewCodes, setViewCodes] = useState<string[] | null>(null);
	/** Hit / freehand text labels on the cutaway (default on). */
	const [showLabels, setShowLabels] = useState(true);
	const [viewZoom, setViewZoom] = useState(1);
	/**
	 * Loaded cutaway pixel size, reported by `CutawayViewer` once its `<img>`
	 * resolves. Shared with `FreehandCloseEditor` so both agree on one
	 * coordinate space regardless of the actual cutaway resolution.
	 */
	const [cutawaySize, setCutawaySize] = useState(DEFAULT_CUTAWAY_SIZE);
	const [tierToTest, setTierToTest] = useState(1);
	const [job, setJob] = useState<JobState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [bust, setBust] = useState(() => Date.now());
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [trainingFeedback, setTrainingFeedback] = useState<TrainingFeedback[]>([]);
	const [refineScreen, setRefineScreen] = useState<RefineScreen>('image');
	const [editMode, setEditMode] = useState<EditMode>('select');
	/** Cleaned closed outline ready for the classify form. */
	const [pendingFreehand, setPendingFreehand] = useState<TracePoint[] | null>(null);
	/** Open stroke awaiting zoomed manual close (gap not auto-snappable). */
	const [pendingCloseStroke, setPendingCloseStroke] = useState<TracePoint[] | null>(null);
	const [matchConfirmOpen, setMatchConfirmOpen] = useState(false);
	const [pendingRlSummary, setPendingRlSummary] = useState<RlFeedbackSummary | null>(null);
	const [rlCursor, setRlCursor] = useState<RlFeedbackCursor | null>(null);
	const [forceFullPrompt, setForceFullPrompt] = useState(false);
	/** Legend View assignment pass after Tier 1 Complete. */
	const [legendMode, setLegendMode] = useState<'all' | 'tier2'>('all');
	/** Selected Database View row (drives right-hand review without leaving DB layout). */
	const [selectedDbRow, setSelectedDbRow] = useState<DatabaseMatchRow | null>(null);
	/**
	 * Short-lived cutaway flash after “Open in Image View” from Database View.
	 * `nonce` re-triggers the animation when the same hit is opened again.
	 * `kind` distinguishes match rings vs freehand polys (index may be -1 for freehand).
	 */
	const [hitFlash, setHitFlash] = useState<{
		code: string;
		index: number | null;
		nonce: number;
		kind: 'match' | 'freehand';
		freehandId?: string | null;
	} | null>(null);
	/** Force cutaway Processing overlay before the match job id exists. */
	const [forceProcessingOverlay, setForceProcessingOverlay] = useState(false);
	const [sessionStartedAt] = useState(() => {
		try {
			const key = 'lung-lab-session-started-at';
			const existing = localStorage.getItem(key);
			if (existing) return existing;
			const now = new Date().toISOString();
			localStorage.setItem(key, now);
			return now;
		} catch {
			return new Date().toISOString();
		}
	});
	const [beforeProgress, setBeforeProgress] = useState<TierProgressSnapshot | null>(null);
	const [afterProgress, setAfterProgress] = useState<TierProgressSnapshot | null>(null);

	/** Last asset identity seen from the server; drives cache-bust bumps. */
	const assetSignatureRef = useRef<string | null>(null);
	/**
	 * Tail of the reload queue. Reloads are serialized so a slow response can
	 * never land after a newer one and repaint the UI with older data.
	 */
	const reloadChain = useRef<Promise<unknown>>(Promise.resolve());
	/** Cold-start landing decision runs once per page load. */
	const bootResolved = useRef(false);

	/**
	 * Fetch bootstrap state + legend items and commit them in one render,
	 * preserving selection when still valid.
	 * @param opts - Whether this step invalidated image assets
	 */
	const fetchAndCommit = useCallback(async (opts: ReloadOptions) => {
		let [nextState, nextItems] = await Promise.all([fetchState(), fetchItems()]);

		// Resolve the landing screen before the first commit, so a cold start never
		// paints the wizard and then swaps to home. `goHome` keeps the analysis
		// bound — it only moves the screen.
		if (!bootResolved.current) {
			bootResolved.current = true;
			if (bootShouldLandOnHome(nextState, nextItems.items.length)) {
				await goHome();
				[nextState, nextItems] = await Promise.all([fetchState(), fetchItems()]);
			}
		}

		setState(nextState);
		setItems(nextItems.items);
		setAnnotations(nextState.annotations?.annotations || []);
		setTrainingFeedback(nextState.trainingFeedback?.feedback || []);
		setRlCursor(nextState.rlCursor || null);

		const signature = assetSignature(nextState);
		const swappedImages =
			assetSignatureRef.current !== null && assetSignatureRef.current !== signature;
		assetSignatureRef.current = signature;
		if (opts.bustAssets || swappedImages) setBust(Date.now());

		const resumedTier = nextState.session.tierToTest;
		if (typeof resumedTier === 'number' && resumedTier >= 1) {
			setTierToTest(Math.min(nextState.session.maxUnlockedTier ?? 3, resumedTier));
		}
		const resumedRefine = nextState.session.refineScreen;
		if (resumedRefine === 'image' || resumedRefine === 'database' || resumedRefine === 'legend') {
			setRefineScreen(resumedRefine);
		}

		setSelectedFinding((prev) => {
			if (!prev) return null;
			const row = nextItems.items.find((i) => i.code === prev.code);
			if (!row?.instances?.length) return null;
			const sameIndex = row.instances[prev.index];
			if (
				sameIndex &&
				Math.abs((sameIndex.cx ?? 0) - (prev.instance.cx ?? 0)) < 2 &&
				Math.abs((sameIndex.cy ?? 0) - (prev.instance.cy ?? 0)) < 2
			) {
				return {
					...prev,
					name: row.name,
					tier: row.tier,
					slug: row.slug,
					instance: { ...sameIndex, ...prev.instance },
				};
			}
			const near = row.instances.findIndex(
				(inst) =>
					Math.abs((inst.cx ?? 0) - (prev.instance.cx ?? 0)) < 2 &&
					Math.abs((inst.cy ?? 0) - (prev.instance.cy ?? 0)) < 2,
			);
			if (near < 0) return prev;
			return {
				code: row.code,
				name: row.name,
				tier: row.tier,
				slug: row.slug,
				instance: row.instances[near],
				index: near,
			};
		});
	}, []);

	/**
	 * Serialized bootstrap reload. Every caller queues behind the previous one so
	 * two refreshes cannot interleave and produce a stale intermediate paint.
	 * @param opts - Whether this step invalidated image assets
	 */
	const reload = useCallback(
		(opts: ReloadOptions = {}) => {
			const next = reloadChain.current
				.catch(() => {})
				.then(() => fetchAndCommit(opts));
			reloadChain.current = next;
			return next;
		},
		[fetchAndCommit],
	);

	useEffect(() => {
		void reload().catch((err: unknown) => {
			setError(err instanceof Error ? err.message : String(err));
		});
	}, [reload]);

	/** Keep Tier to Test within the unlocked gate; reset legend visibility when tier changes. */
	useEffect(() => {
		const max = state?.session.maxUnlockedTier ?? 1;
		if (tierToTest > max) setTierToTest(max);
	}, [state?.session.maxUnlockedTier, tierToTest]);

	/** When Tier to Test advances, show all glyphs for that tier (drop stale Tier-1 code filters). */
	useEffect(() => {
		setViewCodes(null);
	}, [tierToTest]);

	const findings: FindingsDb | null = state?.findings ?? null;
	const screen = state?.session.screen || 'home';

	const tierProgress = useMemo(
		() =>
			[1, 2, 3, 0].map((tier) =>
				computeTierProgress(tier, items, annotations, trainingFeedback),
			),
		[items, annotations, trainingFeedback],
	);

	const pathwayLayers = useMemo(
		() => pathwayLayersFromProfile(state?.styleGuideProfile),
		[state?.styleGuideProfile],
	);

	const databaseModel = useDatabaseViewModel(
		items,
		annotations,
		trainingFeedback,
		tierProgress,
		{
			styleGuideProfile: state?.styleGuideProfile,
			pathwayLayers,
		},
	);

	/** Dim cutaway + Processing… while match (or other pipeline job) is in flight. */
	const cutawayProcessing =
		forceProcessingOverlay ||
		(busy && (job?.status === 'running' || job?.status === 'queued'));

	const processingLabel =
		job?.kind === 'match' || forceProcessingOverlay
			? `Matching Tier ${tierToTest} legend glyphs…`
			: job?.kind === 'extract'
				? 'Extracting legend…'
				: 'Working…';

	/** Legend rows with FP-archived match centers removed from active hit lists. */
	const activeItems = useMemo(
		() => itemsWithoutPurgedHits(items, trainingFeedback, annotations),
		[items, trainingFeedback, annotations],
	);

	/**
	 * Left-rail legend glyphs for Image / Database View: all searchable tiers
	 * through Tier to Test (e.g. Tier 1 + Tier 2 when on Tier 2).
	 */
	const imageViewPanelItems = useMemo(
		() =>
			activeItems.filter((i) => {
				const t = i.tier;
				if (t == null || t < 1) return false;
				return t <= tierToTest;
			}),
		[activeItems, tierToTest],
	);

	const selectedAnnotation = useMemo(() => {
		if (!selectedFinding) return undefined;
		const cx = selectedFinding.instance.cx ?? 0;
		const cy = selectedFinding.instance.cy ?? 0;
		return annotations.find(
			(a) =>
				a.label !== 'false-positive' &&
				a.code === selectedFinding.code &&
				Math.abs(a.cx - cx) < 1.5 &&
				Math.abs(a.cy - cy) < 1.5,
		);
	}, [annotations, selectedFinding]);

	/**
	 * Run a pipeline job with busy flag + live job state.
	 * @param start - Starts the job and returns its initial state
	 */
	async function runJob(start: () => Promise<JobState>) {
		setBusy(true);
		setError(null);
		try {
			const created = await start();
			setJob(created);
			const done = await waitForJob(created.id, setJob);
			if (done.status === 'failed') {
				setError(done.error || `${done.kind} failed`);
			}
			// Pipeline jobs rewrite glyph crops / layer PNGs on disk.
			await reload({ bustAssets: true });
			return done;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return null;
		} finally {
			setBusy(false);
		}
	}

	function patchItem(code: string, patch: Partial<LegendItemRow>) {
		setItems((prev) => prev.map((it) => (it.code === code ? { ...it, ...patch } : it)));
	}

	async function persistAllClassifications() {
		setBusy(true);
		setError(null);
		try {
			const classifications: Record<string, Record<string, unknown>> = {};
			for (const item of items) {
				classifications[item.code] = {
					tier: item.tier,
					subTier: item.subTier,
					iconInterpretation: item.iconInterpretation,
					searchable: item.searchable,
					group: item.group || (item.code.startsWith('A') ? 'base' : 'highlight'),
					slug: item.slug,
					note: item.note,
					assignedPathways: item.assignedPathways || [],
				};
			}
			await saveAllClassifications(classifications);
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Run an async action with busy flag + error surfacing, then reload state.
	 * `fn` must not reload itself — this wrapper owns the single refresh so the UI
	 * swaps once instead of blanking and refilling per redundant fetch.
	 * @param fn - Async work that may return any value
	 * @param opts - Whether the action invalidated image assets
	 */
	async function withBusy(fn: () => Promise<unknown>, opts: ReloadOptions = {}) {
		setBusy(true);
		setError(null);
		try {
			await fn();
			await reload(opts);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Persist Confirm / FP / reclassify (+ optional location tally) and refresh.
	 * False positives are archived then removed from active hits / selection.
	 * @param payload - Annotation label + optional reassignment / note / locationStatus
	 */
	async function handleAnnotate(payload: {
		label: Annotation['label'];
		reassignedCode?: string | null;
		note?: string;
		locationStatus?: LocationTallyKind | null;
	}) {
		if (!selectedFinding) return;
		try {
			const res = await saveAnnotation({
				code: selectedFinding.code,
				cx: selectedFinding.instance.cx ?? 0,
				cy: selectedFinding.instance.cy ?? 0,
				score: selectedFinding.instance.score,
				label: payload.label,
				reassignedCode: payload.reassignedCode,
				note: payload.note,
				locationStatus:
					payload.locationStatus ??
					(payload.label === 'confirmed'
						? 'correct-location'
						: payload.label === 'false-positive'
							? null
							: null),
			});
			setAnnotations(res.annotations.annotations);
			if (res.trainingFeedback?.feedback) {
				setTrainingFeedback(res.trainingFeedback.feedback);
			}
			if (payload.label === 'false-positive' || res.purged) {
				setSelectedFinding(null);
				setEditMode('select');
			}
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * Dismiss freehand classify / close editors and return to select mode.
	 */
	function cancelFreehand() {
		setPendingFreehand(null);
		setPendingCloseStroke(null);
		setEditMode('select');
	}

	/**
	 * Run spur cleanup + auto-close on a finished freehand stroke, then smooth / edge-hug.
	 * Opens the zoomed close editor when the gap is not obvious.
	 * @param raw - Raw pointer samples from the cutaway (not force-closed)
	 */
	async function handleFreehandStrokeComplete(raw: TracePoint[]) {
		const result = cleanFreehandOutline(raw);
		if (result.needsManualClose) {
			setPendingFreehand(null);
			setPendingCloseStroke(raw);
			return;
		}
		setPendingCloseStroke(null);
		const refined = await refineFreehandOutline(
			result.points,
			assetUrl('/api/assets/cutaway', bust),
		);
		setPendingFreehand(refined);
	}

	/**
	 * Accept a manually bridged + cleaned outline and open the classify form.
	 * @param closed - Cleaned closed polyline from FreehandCloseEditor
	 */
	async function handleManualFreehandClosed(closed: TracePoint[]) {
		setPendingCloseStroke(null);
		const refined = await refineFreehandOutline(
			closed,
			assetUrl('/api/assets/cutaway', bust),
		);
		setPendingFreehand(refined);
	}

	/**
	 * Persist a freehand closed-loop classification as training feedback.
	 * Manual expert traces always store score 1.0 (100% confidence).
	 * Existing legend codes inherit that code’s pathways (with form override) and
	 * use the standard legend glyph in Database View — crop icons are for novel codes only.
	 * @param payload - Code, tier, pathways, difficulty note, and closed polyline
	 */
	async function handleFreehandClassify(payload: FreehandClassifyPayload) {
		try {
			const legend = items.find((i) => i.code === payload.code);
			const existingLegendCode = payload.existingLegendCode || Boolean(legend);
			const assignedPathways =
				payload.assignedPathways.length > 0
					? payload.assignedPathways
					: pathwaysForLegendItem(
							legend,
							pathwayLayers,
							state?.styleGuideProfile,
						);
			// Final atlas smooth (+ optional legend-glyph bias for existing codes).
			let points = payload.points;
			if (existingLegendCode && legend) {
				const glyphContour = await extractGlyphContour(
					assetUrl(`/api/assets/glyph/${encodeURIComponent(payload.code)}`, bust),
				);
				points = atlasSmoothClosedOutline(points, {
					iconInterpretation: legend.iconInterpretation || null,
					glyphContour,
				});
			} else {
				points = atlasSmoothClosedOutline(points, {
					iconInterpretation: null,
				});
			}
			const iconPngBase64 = existingLegendCode
				? undefined
				: await renderFreehandLegendIcon(
						points,
						assetUrl('/api/assets/cutaway', bust),
					);
			const res = await saveTrainingFeedback({
				code: payload.code,
				kind: 'freehand-classify',
				points,
				name: payload.name,
				tier: payload.tier,
				difficultyNote: payload.difficultyNote,
				note: payload.note,
				score: 1,
				assignedPathways,
				assignedPathway: assignedPathways[0] ?? null,
				iconPngBase64: iconPngBase64 || undefined,
			});
			setTrainingFeedback(res.trainingFeedback.feedback);
			cancelFreehand();
			// A novel code just wrote a freehand legend icon PNG.
			await reload({ bustAssets: Boolean(iconPngBase64) });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * Build a delta (or full) RL feedback prompt for the active Tier to Test.
	 * Rematch is not run here — paste into Cursor for algorithm work. The active
	 * analysis travels with the prompt so the agent addresses that analysis's own
	 * folder rather than the published site tree.
	 */
	function openFeedbackPrompt(forceFull = forceFullPrompt) {
		const summary = buildRlFeedbackSummary(
			tierToTest,
			items,
			annotations,
			trainingFeedback,
			{
				forceFull,
				cursor: rlCursor,
				since: rlCursor?.consumedAt || sessionStartedAt,
				analysis: state?.analysis ?? null,
			},
		);
		setPendingRlSummary(summary);
		setMatchConfirmOpen(true);
	}

	/**
	 * Persist prompt + advance the delta cursor after the owner copies it.
	 */
	async function copyAndCommitFeedbackPrompt() {
		if (!pendingRlSummary) return;
		const nextCursor = advanceRlCursor(rlCursor, pendingRlSummary);
		await saveRlFeedback({
			tierToTest: pendingRlSummary.tierToTest,
			promptMarkdown: pendingRlSummary.promptMarkdown,
			summary: pendingRlSummary,
			cursor: nextCursor,
		});
		setRlCursor(nextCursor);
	}

	/**
	 * Jump from Database row into Image View with the match selected when possible,
	 * and flash the matching hit (or freehand outline) briefly so it stands out.
	 * @param finding - Hit to select, or null
	 * @param code - Legend code to focus
	 * @param tier - Optional tier to unlock visibility when different from Tier to Test
	 * @param opts - Optional freehand id / kind when opening a freehand row
	 */
	function openInReview(
		finding: SelectedFinding | null,
		code: string,
		tier?: number | null,
		opts?: { kind?: 'match' | 'freehand'; freehandId?: string | null },
	) {
		const nextTier = finding?.tier ?? tier ?? null;
		const kind =
			opts?.kind ??
			(finding != null && (finding.index ?? -1) >= 0 ? 'match' : 'freehand');
		// Ensure the target code is visible (filters can hide the flash target).
		setViewCodes(null);
		setRefineScreen('image');
		setEditMode('select');
		setSelectedCodes([code]);
		setSelectedCode(code);
		setSelectedFinding(finding);
		setSelectedDbRow(null);
		// Tier to Test is the verification gate — never lower it when opening an
		// older-tier DB row (that used to reset Mark Complete back to Tier 1).
		const maxUnlocked = state?.session.maxUnlockedTier ?? tierToTest;
		if (nextTier != null && nextTier > tierToTest) {
			const raised = Math.min(maxUnlocked, nextTier);
			if (raised > tierToTest) {
				setTierToTest(raised);
				void persistUiState({ refineScreen: 'image', tierToTest: raised });
			} else {
				void persistUiState({ refineScreen: 'image' });
			}
		} else {
			void persistUiState({ refineScreen: 'image' });
		}
		// Defer flash until after Image View mounts CutawayViewer (Database View
		// unmounts the viewer). A new nonce always restarts the CSS animation.
		const flashPayload = {
			code,
			index: kind === 'match' ? (finding?.index ?? null) : null,
			nonce: Date.now(),
			kind,
			freehandId: opts?.freehandId ?? null,
		};
		setHitFlash(null);
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				setHitFlash(flashPayload);
			});
		});
	}

	/**
	 * Select a Database View row into the right-hand review panel (stay on Database View).
	 * @param row - Clicked table row
	 */
	function handleSelectDbRow(row: DatabaseMatchRow) {
		setSelectedDbRow(row);
		setSelectedCodes([row.code]);
		setSelectedCode(row.code);
		setEditMode('select');
		setSelectedFinding(row.finding);
	}

	/**
	 * Permanently delete a Database View row from all active views (optimistic + API).
	 * Match hits leave a `deleted` marker so rematch reload stays suppressed;
	 * pending code placeholders leave a `deleted-code` marker;
	 * freehand rows remove the training-feedback entry.
	 * Confirmed / locked-looking hits are deletable (maintainer purge).
	 * @param row - Table row to delete
	 */
	async function handleDeleteDbRow(row: DatabaseMatchRow) {
		if (!rowIsDeletable(row)) return;
		const isPendingPlaceholder =
			row.kind === 'match' && (row.cx == null || row.cy == null || row.index < 0);
		const label =
			row.kind === 'freehand'
				? `freehand ${row.code}`
				: isPendingPlaceholder
					? `pending ${row.code}`
					: `hit ${row.code} @ (${Math.round(row.cx ?? 0)}, ${Math.round(row.cy ?? 0)})`;
		if (
			!window.confirm(
				`Delete ${label} from Database View, Image View, findings, and review data? This cannot be undone.`,
			)
		) {
			return;
		}

		const cx = row.cx;
		const cy = row.cy;

		// Optimistic: clear selection + hide from local state immediately.
		if (selectedDbRow?.id === row.id) setSelectedDbRow(null);
		setSelectedFinding((prev) => {
			if (!prev) return null;
			if (row.kind === 'freehand' || isPendingPlaceholder) return prev;
			if (prev.code !== row.code) return prev;
			if (cx == null || cy == null) return prev;
			if (
				Math.abs((prev.instance.cx ?? 0) - cx) < 1.5 &&
				Math.abs((prev.instance.cy ?? 0) - cy) < 1.5
			) {
				return null;
			}
			return prev;
		});

		if (row.kind === 'freehand') {
			setTrainingFeedback((prev) => prev.filter((f) => f.id !== row.id));
		} else if (isPendingPlaceholder) {
			setTrainingFeedback((prev) => {
				const withoutDup = prev.filter(
					(f) => !(f.kind === 'deleted-code' && f.code === row.code),
				);
				return [
					...withoutDup,
					{
						id: `deleted-code-optimistic-${row.code}`,
						code: row.code,
						kind: 'deleted-code' as const,
						from: null,
						to: null,
						points: null,
						note: 'Deleted pending row from Database View',
						createdAt: new Date().toISOString(),
					},
				];
			});
			setAnnotations((prev) => prev.filter((a) => a.code !== row.code));
			setItems((prev) =>
				prev.map((it) =>
					it.code === row.code
						? { ...it, instances: [], instanceCount: 0, status: 'missed' as const }
						: it,
				),
			);
		} else if (cx != null && cy != null) {
			setAnnotations((prev) =>
				prev.filter(
					(a) =>
						!(
							a.code === row.code &&
							Math.abs(a.cx - cx) < 1.5 &&
							Math.abs(a.cy - cy) < 1.5
						),
				),
			);
			setTrainingFeedback((prev) => {
				const scrubbed = prev.filter((f) => {
					if (f.kind === 'deleted' || f.kind === 'deleted-code' || f.kind === 'freehand-classify')
						return true;
					if (f.code !== row.code) return true;
					if (f.from?.cx == null || f.from?.cy == null) return true;
					return Math.abs(f.from.cx - cx) >= 1.5 || Math.abs(f.from.cy - cy) >= 1.5;
				});
				const hasMarker = scrubbed.some(
					(f) =>
						f.kind === 'deleted' &&
						f.code === row.code &&
						f.from != null &&
						Math.abs(f.from.cx - cx) < 1.5 &&
						Math.abs(f.from.cy - cy) < 1.5,
				);
				if (hasMarker) return scrubbed;
				return [
					...scrubbed,
					{
						id: `deleted-optimistic-${row.code}:${cx}:${cy}`,
						code: row.code,
						kind: 'deleted' as const,
						from: { cx, cy },
						to: null,
						points: null,
						note: 'Deleted from Database View',
						createdAt: new Date().toISOString(),
					},
				];
			});
			setItems((prev) =>
				prev.map((it) => {
					if (it.code !== row.code) return it;
					const instances = (it.instances || []).filter(
						(inst) =>
							Math.abs((inst.cx ?? 0) - cx) >= 1.5 ||
							Math.abs((inst.cy ?? 0) - cy) >= 1.5,
					);
					if (instances.length === (it.instances || []).length) return it;
					return { ...it, instances, instanceCount: instances.length };
				}),
			);
		}

		try {
			const res = await deleteDatabaseRow(
				row.kind === 'freehand'
					? { kind: 'freehand', code: row.code, feedbackId: row.id }
					: isPendingPlaceholder
						? { kind: 'match', code: row.code, deleteCode: true }
						: {
								kind: 'match',
								code: row.code,
								cx: cx ?? 0,
								cy: cy ?? 0,
							},
			);
			setAnnotations(res.annotations.annotations);
			setTrainingFeedback(res.trainingFeedback.feedback);
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			await reload().catch(() => {});
		}
	}

	/**
	 * Permanently delete an analysis; stay on home if it was the active one.
	 * The single `withBusy` reload already returns the pruned list and healed
	 * session, so no optimistic patch is layered on top of it.
	 * @param id - Analysis id
	 */
	async function handleDeleteAnalysis(id: string) {
		await withBusy(async () => {
			await deleteAnalysis(id);
		});
	}

	/**
	 * Rename an analysis and patch the local copy in place.
	 * Deliberately does not reload: the name is the only thing that changed, and a
	 * full refresh would re-request every image for a text edit.
	 * @param id - Analysis id
	 * @param name - New display name (trimmed; empty is ignored)
	 */
	async function handleRenameAnalysis(id: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		try {
			const res = await renameAnalysis(id, trimmed);
			setState((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					analyses: res.analyses ?? prev.analyses,
					session:
						prev.session.analysisId === id
							? { ...prev.session, analysisName: res.name }
							: prev.session,
				};
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * Persist Tier to Test + refine sub-view so switching analyses restores them.
	 * @param patch - UI state patch
	 */
	async function persistUiState(patch: {
		tierToTest?: number;
		refineScreen?: RefineScreen;
	}) {
		try {
			await saveSessionUiState(patch);
		} catch {
			/* best-effort; snapshot on home/open still captures meta */
		}
	}

	/**
	 * Update refine sub-view locally and persist for analysis resume.
	 * @param next - Image / database / legend
	 */
	function selectRefineScreen(next: RefineScreen) {
		setRefineScreen(next);
		void persistUiState({ refineScreen: next });
	}

	/**
	 * Save current classifications and auto-run OpenCV match for the active tier.
	 * Switches to Image View immediately so the Processing overlay is visible on the cutaway.
	 * @param nextTier - Tier to Test to lock after match
	 * @param nextScreen - Refine screen to show after match
	 */
	async function saveClassificationsAndMatch(
		nextTier: number,
		nextScreen: RefineScreen = 'image',
	) {
		setForceProcessingOverlay(true);
		setBusy(true);
		setError(null);
		setTierToTest(nextTier);
		setRefineScreen(nextScreen);
		setViewCodes(null);
		setLegendMode('all');
		void persistUiState({ tierToTest: nextTier, refineScreen: nextScreen });
		try {
			const classifications: Record<string, Record<string, unknown>> = {};
			for (const item of items) {
				classifications[item.code] = {
					tier: item.tier,
					subTier: item.subTier,
					iconInterpretation: item.iconInterpretation,
					searchable: item.searchable,
					group: item.group || (item.code.startsWith('A') ? 'base' : 'highlight'),
					slug: item.slug,
					note: item.note,
					assignedPathways: item.assignedPathways || [],
				};
			}
			await saveAllClassifications(classifications);
			const created = await startMatch({ tierToTest: nextTier });
			setJob(created);
			const done = await waitForJob(created.id, setJob);
			if (done.status === 'failed') {
				setError(done.error || `${done.kind} failed`);
			}
			await reload({ bustAssets: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setForceProcessingOverlay(false);
			setBusy(false);
		}
	}

	/**
	 * Unlock Tier 2, persist known Tier-2 prefills, and open Legend View for review.
	 * Part of the natural refine pipeline for every analysis (not new-only).
	 */
	async function handleTier1Complete() {
		setBusy(true);
		setError(null);
		try {
			const seeded = seedKnownTierAfterTier1(items);
			setItems(seeded);
			const classifications: Record<string, Record<string, unknown>> = {};
			for (const item of seeded) {
				classifications[item.code] = {
					tier: item.tier,
					subTier: item.subTier,
					iconInterpretation: item.iconInterpretation,
					searchable: item.searchable,
					group: item.group || (item.code.startsWith('A') ? 'base' : 'highlight'),
					slug: item.slug,
					note: item.note,
					assignedPathways: item.assignedPathways || [],
				};
			}
			await saveAllClassifications(classifications);
			await setTierGate(2, { tierToTest: 2, refineScreen: 'legend' });
			setLegendMode('tier2');
			setRefineScreen('legend');
			setTierToTest(2);
			await reload();
			setItems((prev) => seedKnownTierAfterTier1(prev));
			setSelectedCodes([]);
			setSelectedCode(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Mark the current Tier to Test complete: unlock the next tier (when any) and
	 * advance the refine pipeline. Always available in the right-panel footer while
	 * refining on that tier.
	 */
	async function handleMarkTierComplete() {
		const completed = tierToTest;
		if (completed === 1) {
			await handleTier1Complete();
			return;
		}
		setBusy(true);
		setError(null);
		try {
			if (completed === 2) {
				const seeded = seedKnownTierAfterTier2(items);
				setItems(seeded);
				const classifications: Record<string, Record<string, unknown>> = {};
				for (const item of seeded) {
					classifications[item.code] = {
						tier: item.tier,
						subTier: item.subTier,
						iconInterpretation: item.iconInterpretation,
						searchable: item.searchable,
						group: item.group || (item.code.startsWith('A') ? 'base' : 'highlight'),
						slug: item.slug,
						note: item.note,
						assignedPathways: item.assignedPathways || [],
					};
				}
				await saveAllClassifications(classifications);
				await setTierGate(3, { tierToTest: 3, refineScreen: 'legend' });
				setLegendMode('all');
				setRefineScreen('legend');
				setTierToTest(3);
				await reload();
				setItems((prev) => seedKnownTierAfterTier2(prev));
				setSelectedCodes([]);
				setSelectedCode(null);
			} else {
				// Tier 3 is the last searchable gate — persist unlock and stay put.
				await setTierGate(3, { tierToTest: 3, refineScreen });
				setTierToTest(3);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Persist edits to the current style-guide profile on disk.
	 * @param profileId - Catalog id to update
	 * @param profile - Profile body
	 * @param markdown - Markdown source
	 */
	async function handleSaveStyleGuide(
		profileId: string,
		profile: Record<string, unknown>,
		markdown: string,
	) {
		await withBusy(async () => {
			await saveStyleGuideProfile(profileId, profile, markdown);
		});
	}

	/**
	 * Create a new style-guide profile from the editor draft and bind this analysis.
	 * @param profile - Profile body
	 * @param opts - Optional new id + markdown
	 */
	async function handleSaveStyleGuideAsNew(
		profile: Record<string, unknown>,
		opts: { id?: string; markdown: string },
	) {
		await withBusy(async () => {
			await saveStyleGuideProfileAsNew(profile, {
				id: opts.id,
				markdown: opts.markdown,
			});
		});
	}

	if (!state) {
		return (
			<div className="app" style={{ padding: '2rem' }}>
				<p>Loading lung legend lab…</p>
				{error && <div className="error-banner">{error}</div>}
			</div>
		);
	}

	if (screen === 'home') {
		return (
			<div className="app">
				{error && <div className="error-banner">{error}</div>}
				<SessionHome
					analyses={state.analyses || []}
					busy={busy}
					onOpen={(id) =>
						void withBusy(async () => {
							await openAnalysis(id);
						})
					}
					onNew={(name) =>
						void withBusy(async () => {
							await createNewAnalysis(name);
						})
					}
					onRename={(id, name) => void handleRenameAnalysis(id, name)}
					onDelete={(id) => void handleDeleteAnalysis(id)}
				/>
			</div>
		);
	}

	if (screen === 'classify') {
		return (
			<div className="app">
				{error && <div className="error-banner">{error}</div>}
				<ClassifyWizard
					items={items}
					subTiers={state.enums.subTiers}
					iconInterpretations={state.enums.iconInterpretations}
					guidelines={
						state.extract?.guidelines ||
						state.classification?.guidelines ||
						state.findings?.criteria?.guidelines
					}
					busy={busy}
					bust={bust}
					analysisName={state.session.analysisName}
					onRenameAnalysis={(name) => {
						const id = state.session.analysisId;
						if (id) void handleRenameAnalysis(id, name);
					}}
					cutawayExists={state.session.cutawayExists}
					legendExists={state.session.legendExists}
					styleGuideProfiles={state.styleGuideProfiles || []}
					styleGuideProfile={state.styleGuideProfile}
					styleGuideProfileId={state.session.styleGuideProfileId}
					onSelectStyleGuide={(profileId) =>
						void withBusy(async () => setStyleGuideProfile(profileId))
					}
					onSaveStyleGuide={handleSaveStyleGuide}
					onSaveStyleGuideAsNew={handleSaveStyleGuideAsNew}
					onUploadImages={(cutaway, legend, name) =>
						void withBusy(
							async () => {
								const id = state.session.analysisId;
								if (id) {
									await uploadAnalysisImages(id, cutaway, legend, name);
								} else {
									await uploadAssets(cutaway, legend);
								}
							},
							{ bustAssets: true },
						)
					}
					onExtract={() => void runJob(startExtract)}
					onChange={patchItem}
					onSaveAll={() => void persistAllClassifications()}
					onFinish={() =>
						void (async () => {
							setBusy(true);
							setError(null);
							try {
								const classifications: Record<string, Record<string, unknown>> = {};
								for (const item of items) {
									classifications[item.code] = {
										tier: item.tier,
										subTier: item.subTier,
										iconInterpretation: item.iconInterpretation,
										searchable: item.searchable,
										group:
											item.group ||
											(item.code.startsWith('A') ? 'base' : 'highlight'),
										slug: item.slug,
										note: item.note,
									};
								}
								await saveAllClassifications(classifications);
								await setSessionPhase('refine');
								await setTierGate(1, { tierToTest: 1, refineScreen: 'image' });
								setTierToTest(1);
								setRefineScreen('image');
								setLegendMode('all');
								const created = await startMatch({ tierToTest: 1 });
								setJob(created);
								const done = await waitForJob(created.id, setJob);
								if (done.status === 'failed') {
									setError(done.error || 'match failed');
								}
								await reload({ bustAssets: true });
							} catch (err) {
								setError(err instanceof Error ? err.message : String(err));
							} finally {
								setBusy(false);
							}
						})()
					}
					onHome={() => void withBusy(async () => goHome())}
				/>
			</div>
		);
	}

	const runMatchSlot = (
		<div className="run-match-block">
			<button
				type="button"
				className="primary"
				disabled={busy}
				onClick={() => openFeedbackPrompt()}
			>
				Generate Feedback Prompt
			</button>
			{tierToTest >= 1 && tierToTest <= 3 && (
				<button
					type="button"
					className="primary tier-complete-btn"
					disabled={busy}
					onClick={() => void handleMarkTierComplete()}
					title={
						tierToTest === 1
							? 'Unlock Tier 2, open Legend View for assignment, then Save to run match'
							: tierToTest === 2
								? 'Unlock Tier 3 and open Legend View for remaining assignments'
								: 'Tier 3 is the final searchable gate'
					}
				>
					Mark Tier {tierToTest} Complete
				</button>
			)}
			<p className="muted" style={{ margin: '0.35rem 0 0' }}>
				Builds a <strong>MODE-tagged</strong> delta Cursor prompt for{' '}
				<strong>Tier {tierToTest} only</strong> (calibration vs freehand geometry vs mixed),
				addressed to{' '}
				<strong>{state.analysis?.name || state.session.analysisName || 'this analysis'}</strong>{' '}
				and its own folder. Rematch is done in chat — not in this lab.
			</p>
		</div>
	);

	return (
		<div className="app refine-app">
			<header className="topbar">
				<div>
					<h1>
						{state.session.analysisName || 'Analysis'}
						<span className="tag">Refine</span>
					</h1>
				</div>
				<nav className="refine-nav" aria-label="Refine views">
					<button
						type="button"
						className={refineScreen === 'image' ? 'primary' : undefined}
						onClick={() => selectRefineScreen('image')}
					>
						Image View
					</button>
					<button
						type="button"
						className={refineScreen === 'database' ? 'primary' : undefined}
						onClick={() => selectRefineScreen('database')}
					>
						Database View
					</button>
					<button
						type="button"
						className={refineScreen === 'legend' ? 'primary' : undefined}
						onClick={() => selectRefineScreen('legend')}
					>
						Legend View
					</button>
				</nav>
				<button
					type="button"
					className="analyses-home-btn"
					disabled={busy}
					onClick={() => void withBusy(async () => goHome())}
				>
					Analyses
				</button>
			</header>

			{error && <div className="error-banner">{error}</div>}

			{refineScreen === 'legend' ? (
				<LegendViewPage
					items={items}
					iconInterpretations={state.enums.iconInterpretations}
					guidelines={
						state.extract?.guidelines ||
						state.classification?.guidelines ||
						state.findings?.criteria?.guidelines
					}
					busy={busy}
					bust={bust}
					styleGuideProfiles={state.styleGuideProfiles || []}
					styleGuideProfile={state.styleGuideProfile}
					styleGuideProfileId={state.session.styleGuideProfileId}
					onStyleGuideSelect={(profileId) =>
						void withBusy(async () => setStyleGuideProfile(profileId))
					}
					onSaveStyleGuide={handleSaveStyleGuide}
					onSaveStyleGuideAsNew={handleSaveStyleGuideAsNew}
					mode={legendMode}
					onChange={patchItem}
					onSaveAll={() =>
						void (async () => {
							if (legendMode === 'tier2') {
								await saveClassificationsAndMatch(2, 'image');
							} else {
								await persistAllClassifications();
							}
						})()
					}
				/>
			) : (
				<div className="refine-workspace">
					<main className="refine-main">
						<div
							className={`refine-image-row${refineScreen === 'database' ? ' refine-image-row--database' : ''}`}
						>
							<ImageViewPanel
								items={imageViewPanelItems}
								pathwayLayers={pathwayLayers}
								viewPathwayIds={viewPathwayIds}
								onViewPathwayIdsChange={setViewPathwayIds}
								viewCodes={viewCodes}
								onViewCodesChange={setViewCodes}
								showLabels={showLabels}
								onShowLabelsChange={setShowLabels}
								zoom={viewZoom}
								onZoomChange={setViewZoom}
								showZoom={refineScreen !== 'database'}
								bust={bust}
								busy={busy}
							/>
							{refineScreen === 'database' ? (
								<DatabasePipelinePage
									model={databaseModel}
									findings={findings}
									job={job}
									tierProgress={tierProgress}
									tierToTest={tierToTest}
									beforeProgress={beforeProgress}
									afterProgress={afterProgress}
									selectedRowId={selectedDbRow?.id ?? null}
									bust={bust}
									busy={busy}
									onSelectRow={handleSelectDbRow}
									onOpenInReview={openInReview}
									onDeleteRow={(row) => void handleDeleteDbRow(row)}
								/>
							) : (
								<CutawayViewer
									items={activeItems}
									outlineSlugs={state.outlineSlugs}
									selectedCode={selectedCode}
									tierToTest={tierToTest}
									pathwayLayers={pathwayLayers}
									styleGuideProfile={state.styleGuideProfile}
									viewPathwayIds={viewPathwayIds}
									viewCodes={viewCodes}
									showLabels={showLabels}
									annotations={annotations}
									trainingFeedback={trainingFeedback}
									bust={bust}
									selectedFinding={selectedFinding}
									hitFlash={hitFlash}
									onHitFlashEnd={() => setHitFlash(null)}
									editMode={editMode}
									zoom={viewZoom}
									onZoomChange={setViewZoom}
									onSelectFinding={setSelectedFinding}
									onSelectCode={setSelectedCode}
									onFreehandComplete={(pts) => void handleFreehandStrokeComplete(pts)}
									outlinePreview={pendingFreehand ?? pendingCloseStroke}
									processing={cutawayProcessing}
									processingLabel={processingLabel}
									onCutawaySize={setCutawaySize}
								/>
							)}
						</div>
					</main>

					<aside className="panel refine-side">
						<SideTabs
							title={
								refineScreen === 'database'
									? 'Database review'
									: `Tier ${tierToTest} Review`
							}
							footer={runMatchSlot}
						>
							{refineScreen === 'database' && selectedDbRow && !selectedDbRow.finding ? (
								<div className="panel-section detail finding-detail">
									<div className="row" style={{ justifyContent: 'space-between' }}>
										<h3 style={{ margin: 0 }}>Selected row</h3>
										<button
											type="button"
											onClick={() => {
												setSelectedDbRow(null);
												setSelectedFinding(null);
											}}
										>
											Clear
										</button>
									</div>
									<p className="mono" style={{ marginBottom: 4 }}>
										{selectedDbRow.code} · {selectedDbRow.name}
									</p>
									<p className="muted" style={{ marginTop: 0 }}>
										Status {selectedDbRow.status}
										{selectedDbRow.kind === 'freehand'
											? ` · freehand · ${selectedDbRow.pointCount ?? 0} pts`
											: ' · no active hit'}
										{selectedDbRow.tier != null ? ` · Tier ${selectedDbRow.tier}` : ''}
									</p>
									{selectedDbRow.difficultyNote && (
										<p className="muted">{selectedDbRow.difficultyNote}</p>
									)}
									<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
										<button
											type="button"
											className="primary"
											onClick={() =>
												openInReview(null, selectedDbRow.code, selectedDbRow.tier, {
													kind: 'freehand',
													freehandId: selectedDbRow.id,
												})
											}
										>
											Open in Image View
										</button>
										{rowIsDeletable(selectedDbRow) && (
											<button
												type="button"
												className="analysis-delete-btn"
												disabled={busy}
												onClick={() => void handleDeleteDbRow(selectedDbRow)}
											>
												Delete
											</button>
										)}
									</div>
								</div>
							) : (
								<>
									<FindingDetail
										finding={selectedFinding}
										annotation={selectedAnnotation}
										items={items}
										tierToTest={tierToTest}
										editMode={editMode}
										onEditMode={(mode) => {
											setEditMode(mode);
											if (mode !== 'freehand-classify') {
												setPendingFreehand(null);
												setPendingCloseStroke(null);
											}
										}}
										onAnnotate={(payload) => void handleAnnotate(payload)}
										onClearSelection={() => {
											setSelectedFinding(null);
											setSelectedDbRow(null);
											setEditMode('select');
											setPendingFreehand(null);
											setPendingCloseStroke(null);
										}}
									/>
									{refineScreen === 'database' && selectedFinding && (
										<div className="action-block" style={{ marginTop: 8 }}>
											<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
												<button
													type="button"
													onClick={() =>
														openInReview(
															selectedFinding,
															selectedFinding.code,
															selectedFinding.tier ?? selectedDbRow?.tier,
															{
																kind:
																	selectedDbRow?.kind === 'freehand'
																		? 'freehand'
																		: 'match',
																freehandId:
																	selectedDbRow?.kind === 'freehand'
																		? selectedDbRow.id
																		: null,
															},
														)
													}
												>
													Open in Image View
												</button>
												{selectedDbRow && rowIsDeletable(selectedDbRow) && (
													<button
														type="button"
														className="analysis-delete-btn"
														disabled={busy}
														onClick={() => void handleDeleteDbRow(selectedDbRow)}
													>
														Delete
													</button>
												)}
											</div>
										</div>
									)}
								</>
							)}
							{refineScreen === 'image' && (
								<details className="panel-section">
									<summary className="muted">Hit list · Tier {tierToTest}</summary>
									<ul className="run-list">
										{activeItems
											.filter(
												(i) =>
													i.tier === tierToTest && (i.instances?.length || 0) > 0,
											)
											.map((i) => (
												<li key={i.code}>
													<button
														type="button"
														className="linkish"
														onClick={() => {
															setSelectedCodes([i.code]);
															setSelectedCode(i.code);
															setEditMode('select');
														}}
													>
														{i.code} · {i.instances.length} hit(s) · best{' '}
														{i.bestScore != null ? i.bestScore.toFixed(3) : '—'}
													</button>
												</li>
											))}
									</ul>
								</details>
							)}
						</SideTabs>
					</aside>
				</div>
			)}

			{pendingCloseStroke && (
				<FreehandCloseEditor
					points={pendingCloseStroke}
					bust={bust}
					busy={busy}
					cutawayWidth={cutawaySize.w}
					cutawayHeight={cutawaySize.h}
					onCancel={cancelFreehand}
					onClosed={(closed) => void handleManualFreehandClosed(closed)}
				/>
			)}

			{pendingFreehand && !pendingCloseStroke && (
				<FreehandClassifyForm
					points={pendingFreehand}
					items={items}
					pathwayLayers={pathwayLayers}
					styleGuideProfile={state?.styleGuideProfile}
					defaultCode={selectedFinding?.code || selectedCodes[0] || selectedCode || ''}
					busy={busy}
					onCancel={cancelFreehand}
					onSubmit={(payload) => void handleFreehandClassify(payload)}
				/>
			)}

			<FeedbackPromptModal
				open={matchConfirmOpen}
				summary={pendingRlSummary}
				busy={busy}
				forceFull={forceFullPrompt}
				onForceFullChange={(value) => {
					setForceFullPrompt(value);
					const summary = buildRlFeedbackSummary(
						tierToTest,
						items,
						annotations,
						trainingFeedback,
						{
							forceFull: value,
							cursor: rlCursor,
							since: rlCursor?.consumedAt || sessionStartedAt,
						},
					);
					setPendingRlSummary(summary);
				}}
				onClose={() => {
					setMatchConfirmOpen(false);
					setPendingRlSummary(null);
				}}
				onCopyAndCommit={copyAndCommitFeedbackPrompt}
			/>
		</div>
	);
}
