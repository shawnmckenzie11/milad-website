import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	createNewAnalysis,
	fetchItems,
	fetchState,
	goHome,
	openAnalysis,
	saveAnnotation,
	saveAllClassifications,
	saveCurrentAnalysis,
	saveTrainingFeedback,
	seedCurrentAnalysis,
	setSessionPhase,
	startExtract,
	startMatch,
	uploadAnalysisImages,
	uploadAssets,
	waitForJob,
} from './api';
import { ClassifyWizard } from './components/ClassifyWizard';
import { CutawayViewer, type SelectedFinding } from './components/CutawayViewer';
import { FindingDetail } from './components/FindingDetail';
import { LayerRail } from './components/LayerRail';
import { SessionHome } from './components/SessionHome';
import { SideTabs } from './components/SideTabs';
import type {
	Annotation,
	BoxGeom,
	EditMode,
	FindingsDb,
	JobState,
	LabState,
	LegendItemRow,
	TracePoint,
	TrainingFeedback,
} from './types';

/**
 * Root maintainer app: home → classify wizard → refine dashboard (layer-focused).
 */
export default function App() {
	const [state, setState] = useState<LabState | null>(null);
	const [items, setItems] = useState<LegendItemRow[]>([]);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const [selectedFinding, setSelectedFinding] = useState<SelectedFinding | null>(null);
	const [pathwayFilter, setPathwayFilter] = useState('all');
	const [layerFilter, setLayerFilter] = useState('all');
	const [job, setJob] = useState<JobState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [bust, setBust] = useState(() => Date.now());
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [trainingFeedback, setTrainingFeedback] = useState<TrainingFeedback[]>([]);
	const [sideTab, setSideTab] = useState<'match' | 'pipeline'>('match');
	const [editMode, setEditMode] = useState<EditMode>('select');

	/**
	 * Reload bootstrap state + legend items, preserving selection when still valid.
	 */
	const reload = useCallback(async () => {
		const [nextState, nextItems] = await Promise.all([fetchState(), fetchItems()]);
		setState(nextState);
		setItems(nextItems.items);
		setAnnotations(nextState.annotations?.annotations || []);
		setTrainingFeedback(nextState.trainingFeedback?.feedback || []);
		setBust(Date.now());

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

	useEffect(() => {
		void reload().catch((err: unknown) => {
			setError(err instanceof Error ? err.message : String(err));
		});
	}, [reload]);

	const findings: FindingsDb | null = state?.findings ?? null;
	const screen = state?.session.screen || 'home';

	const selectedAnnotation = useMemo(() => {
		if (!selectedFinding) return undefined;
		const cx = selectedFinding.instance.cx ?? 0;
		const cy = selectedFinding.instance.cy ?? 0;
		return annotations.find(
			(a) =>
				a.code === selectedFinding.code &&
				Math.abs(a.cx - cx) < 1.5 &&
				Math.abs(a.cy - cy) < 1.5,
		);
	}, [annotations, selectedFinding]);

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
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
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
	 * @param fn - Async work that may return any value
	 */
	async function withBusy(fn: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await fn();
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Persist Confirm / FP / reclassify and refresh annotations while keeping selection.
	 * @param payload - Annotation label + optional reassignment / note
	 */
	async function handleAnnotate(payload: {
		label: Annotation['label'];
		reassignedCode?: string | null;
		note?: string;
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
			});
			setAnnotations(res.annotations.annotations);
			await reload();
			setSideTab('match');
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * Persist tier-2 geometry feedback (relocate / resize / trace).
	 * @param payload - Geometry teaching payload
	 */
	async function handleGeometryFeedback(payload: {
		code: string;
		kind: 'relocate' | 'resize' | 'trace';
		from?: BoxGeom | null;
		to?: BoxGeom | null;
		points?: TracePoint[] | null;
	}) {
		try {
			const res = await saveTrainingFeedback(payload);
			setTrainingFeedback(res.trainingFeedback.feedback);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
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
					onOpen={(id) => void withBusy(async () => openAnalysis(id))}
					onNew={() => void withBusy(async () => createNewAnalysis('New analysis'))}
					onSeedCurrent={() =>
						void withBusy(async () => {
							await seedCurrentAnalysis();
						})
					}
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
					cutawayExists={state.session.cutawayExists}
					legendExists={state.session.legendExists}
					onUploadImages={(cutaway, legend, name) =>
						void withBusy(async () => {
							const id = state.session.analysisId;
							if (id) {
								await uploadAnalysisImages(id, cutaway, legend, name);
							} else {
								await uploadAssets(cutaway, legend);
							}
						})
					}
					onExtract={() => void runJob(startExtract)}
					onChange={patchItem}
					onSaveAll={() => void persistAllClassifications()}
					onFinish={() =>
						void withBusy(async () => {
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
								};
							}
							await saveAllClassifications(classifications);
							await setSessionPhase('refine');
						})
					}
					onHome={() => void withBusy(async () => goHome())}
				/>
			</div>
		);
	}

	return (
		<div className="app refine-app">
			<header className="topbar">
				<div>
					<h1>
						{state.session.analysisName || 'Analysis'}
						<span className="tag">Refine</span>
					</h1>
					<div className="meta mono">
						{state.session.analysisId} · {busy ? 'busy…' : 'ready'}
						{trainingFeedback.length > 0 ? ` · ${trainingFeedback.length} feedback` : ''}
					</div>
				</div>
				<div className="row">
					<button type="button" disabled={busy} onClick={() => void withBusy(async () => goHome())}>
						Analyses
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void withBusy(async () => setSessionPhase('classify'))}
					>
						Edit classification
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void withBusy(async () => saveCurrentAnalysis())}
					>
						Save
					</button>
					<button
						type="button"
						className="primary"
						disabled={busy}
						onClick={() => void runJob(startMatch)}
					>
						Run match
					</button>
				</div>
			</header>

			{error && <div className="error-banner">{error}</div>}

			<div className="refine-workspace">
				<main className="refine-main">
					<LayerRail
						items={items}
						layerFilter={layerFilter}
						onLayerChange={(code) => {
							setLayerFilter(code);
							setSelectedCode(code === 'all' ? null : code);
						}}
						pathwayFilter={pathwayFilter}
						onPathwayChange={setPathwayFilter}
						pathways={state.enums.pathways}
					/>
					<CutawayViewer
						items={items}
						outlineSlugs={state.outlineSlugs}
						selectedCode={selectedCode}
						layerFilter={layerFilter}
						pathwayFilter={pathwayFilter}
						annotations={annotations}
						bust={bust}
						selectedFinding={selectedFinding}
						editMode={editMode}
						onSelectFinding={(f) => {
							setSelectedFinding(f);
							if (f) setSideTab('match');
						}}
						onSelectCode={setSelectedCode}
						onGeometryFeedback={(payload) => void handleGeometryFeedback(payload)}
					/>
				</main>

				<aside className="panel refine-side">
					<SideTabs
						active={sideTab}
						onChange={setSideTab}
						findings={findings}
						job={job}
						matchPanel={
							<>
								<FindingDetail
									finding={selectedFinding}
									annotation={selectedAnnotation}
									items={items}
									editMode={editMode}
									onEditMode={setEditMode}
									onAnnotate={(payload) => void handleAnnotate(payload)}
									onClearSelection={() => {
										setSelectedFinding(null);
										setEditMode('select');
									}}
								/>
								<details className="panel-section">
									<summary className="muted">Hit list by layer</summary>
									<ul className="run-list">
										{items
											.filter((i) => (i.instances?.length || 0) > 0)
											.map((i) => (
												<li key={i.code}>
													<button
														type="button"
														className="linkish"
														onClick={() => {
															setLayerFilter(i.code);
															setSelectedCode(i.code);
															setSideTab('match');
														}}
													>
														{i.code} · {i.instances.length} hit(s) · best{' '}
														{i.bestScore != null ? i.bestScore.toFixed(3) : '—'}
													</button>
												</li>
											))}
									</ul>
								</details>
							</>
						}
					/>
				</aside>
			</div>
		</div>
	);
}
