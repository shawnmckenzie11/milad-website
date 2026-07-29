import { useEffect, useRef, useState } from 'react';
import type {
	LegendItemRow,
	StyleGuideProfileBrief,
	StyleGuideProfileSummary,
} from '../types';
import { assetUrl, fetchStyleGuideProfile } from '../api';
import {
	DEFAULT_IMAGE_PATHWAYS,
	pathwaysFromSupports,
} from '../lib/styleGuideLayers';

type StableLayerRow = {
	id: string;
	legendCode?: string;
	group?: string;
	frameworkAlias?: string;
	/** Image pathway layer ids (from legend supports ∩ profile imagePathways). */
	pathways?: string[];
	/** Display name from legend extract. */
	name?: string;
	/** Supports text under the legend icon. */
	supports?: string;
};

type Draft = {
	title: string;
	version: string;
	summary: string;
	headline: string;
	convention: string;
	frameworkText: string;
	agentText: string;
	/** Image pathway layers (base / cannabis / …). */
	imagePathways: Array<{ id: string; label: string }>;
	/** Legend detail rows (code + name + pathway); file key is derived from name/code. */
	stableIds: StableLayerRow[];
	ontologyJson: string;
	markdown: string;
	/** Fields preserved on save but not shown as primary editors. */
	rest: Record<string, unknown>;
};

/**
 * Derive a filesystem / match key from the legend name, falling back to the code.
 * Replaces the former editable asset-slug field.
 * @param name - Legend display name
 * @param code - Legend code (A1, A20, …)
 */
function layerKeyFromLegend(name: string | undefined, code: string): string {
	const fromName = (name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return fromName || code.toLowerCase();
}

type Props = {
	profiles: StyleGuideProfileSummary[];
	active: StyleGuideProfileBrief | null;
	selectedId: string | null | undefined;
	busy: boolean;
	/** Compact = refine chrome; full = editable at startup / Legend View. */
	variant?: 'full' | 'compact';
	onSelect: (profileId: string) => void;
	/** Persist edits onto the current profile id. */
	onSave?: (profileId: string, profile: Record<string, unknown>, markdown: string) => void;
	/** Persist edits as a new catalog profile (optional new id). */
	onSaveAsNew?: (
		profile: Record<string, unknown>,
		opts: { id?: string; markdown: string },
	) => void;
	/** Extracted legend rows (icons + supports) to populate Legend Details. */
	legendItems?: LegendItemRow[];
	/** Cache-bust for glyph assets. */
	bust?: number;
};

/**
 * Build an editable draft from a loaded style-guide profile.
 * @param profile - Active brief or full profile
 * @param markdown - Optional markdown body
 */
function draftFromProfile(
	profile: StyleGuideProfileBrief | null,
	markdown = '',
): Draft {
	if (!profile) {
		return {
			title: '',
			version: '1.0.0',
			summary: '',
			headline: '',
			convention: '',
			frameworkText: '',
			agentText: '',
			imagePathways: DEFAULT_IMAGE_PATHWAYS.map((p) => ({ ...p })),
			stableIds: [],
			ontologyJson:
				'{\n  "tissues": [],\n  "cells": [],\n  "pathways": [],\n  "diseaseProcesses": []\n}',
			markdown: '',
			rest: {},
		};
	}
	return {
		title: profile.title || '',
		version: profile.version || '1.0.0',
		summary: profile.summary || '',
		headline: profile.uiBrief?.headline || '',
		convention: profile.layerNaming?.convention || '',
		frameworkText: (profile.illustrationFramework || []).join('\n'),
		agentText: (profile.agentInstructions || []).join('\n'),
		imagePathways:
			profile.imagePathways && profile.imagePathways.length > 0
				? profile.imagePathways.map((p) => ({ id: p.id, label: p.label || p.id }))
				: DEFAULT_IMAGE_PATHWAYS.map((p) => ({ ...p })),
		stableIds: (profile.layerNaming?.stableIds || []).map((row) => ({
			id: row.id,
			legendCode: row.legendCode || '',
			group: row.group || '',
			frameworkAlias: row.frameworkAlias || '',
			pathways: Array.isArray(row.pathways) ? [...row.pathways] : [],
		})),
		ontologyJson: JSON.stringify(
			profile.ontology || {
				tissues: [],
				cells: [],
				pathways: [],
				diseaseProcesses: [],
			},
			null,
			2,
		),
		markdown,
		rest: {
			visualLanguage: profile.visualLanguage,
			siteCompatibility: profile.siteCompatibility,
			imageGenPromptTemplates: profile.imageGenPromptTemplates,
			appliesTo: (profile as StyleGuideProfileBrief & { appliesTo?: string[] }).appliesTo,
			layerNaming: profile.layerNaming,
			uiBrief: profile.uiBrief,
			imagePathways: profile.imagePathways,
		},
	};
}

/**
 * Assemble a profile object suitable for Save / Save as new.
 * @param draft - Editor draft
 * @param baseId - Profile id to stamp (current or new)
 */
function profileFromDraft(draft: Draft, baseId: string): Record<string, unknown> {
	let ontology: unknown = draft.rest.ontology ?? null;
	try {
		ontology = JSON.parse(draft.ontologyJson);
	} catch {
		/* keep previous */
	}
	const uiBrief = {
		...((draft.rest.uiBrief as object) || {}),
		headline: draft.headline,
		namingExamples: draft.stableIds
			.slice(0, 4)
			.map((s) => `${s.legendCode || '?'} → ${s.name || layerKeyFromLegend(s.name, s.legendCode || '')}`),
	};
	const layerNaming = {
		...((draft.rest.layerNaming as object) || {}),
		convention: draft.convention,
		stableIds: draft.stableIds
			.filter((r) => (r.legendCode || '').trim())
			.map((r) => {
				const code = (r.legendCode || '').trim();
				return {
					id: layerKeyFromLegend(r.name, code),
					legendCode: code || undefined,
					group: r.group?.trim() || undefined,
					frameworkAlias: r.frameworkAlias?.trim() || undefined,
					pathways: (r.pathways || []).filter(Boolean),
				};
			}),
	};
	return {
		...draft.rest,
		id: baseId,
		title: draft.title.trim() || 'Untitled style guide',
		version: draft.version.trim() || '1.0.0',
		summary: draft.summary.trim(),
		illustrationFramework: draft.frameworkText
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean),
		agentInstructions: draft.agentText
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean),
		ontology,
		imagePathways: draft.imagePathways
			.filter((p) => p.id.trim())
			.map((p) => ({ id: p.id.trim(), label: (p.label || p.id).trim() })),
		layerNaming,
		uiBrief,
	};
}

/**
 * Merge extracted legend rows into style-guide legend detail rows.
 * File/match keys are derived from the legend name (or code); pathway picks are
 * preserved when still present in the pathway catalog above.
 * @param existing - Current draft stable ids
 * @param legendItems - Extracted legend items
 * @param imagePathways - Confirmed pathway options
 */
function mergeLegendDetails(
	existing: StableLayerRow[],
	legendItems: LegendItemRow[],
	imagePathways: Array<{ id: string; label: string }>,
): StableLayerRow[] {
	if (!legendItems.length) return existing;
	const byCode = new Map(
		existing.filter((r) => r.legendCode).map((r) => [r.legendCode as string, r]),
	);
	const allowed = new Set(
		imagePathways.map((p) => p.id.trim()).filter(Boolean),
	);
	const layers = imagePathways.map((p) => ({ id: p.id, label: p.label || p.id }));
	return legendItems.map((it) => {
		const prev = byCode.get(it.code);
		const fromSupports = pathwaysFromSupports(it.supports, layers).filter((id) =>
			allowed.has(id),
		);
		const kept = (prev?.pathways || []).filter((id) => allowed.has(id));
		const pathways = kept.length > 0 ? kept : fromSupports;
		return {
			id: layerKeyFromLegend(it.name, it.code),
			legendCode: it.code,
			group: prev?.group || (it.code.startsWith('A') ? 'base' : 'highlight'),
			frameworkAlias: prev?.frameworkAlias,
			pathways,
			name: it.name,
			supports: it.supports,
		};
	});
}

/**
 * Style-guide profile picker + editable form (Save / Save as new).
 * Shown at classify-wizard startup and on Legend View → Style guide.
 */
export function StyleGuidePanel({
	profiles,
	active,
	selectedId,
	busy,
	variant = 'full',
	onSelect,
	onSave,
	onSaveAsNew,
	legendItems = [],
	bust = 0,
}: Props) {
	const id = selectedId || active?.id || profiles[0]?.id || '';
	const [draft, setDraft] = useState<Draft>(() => draftFromProfile(active));
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveAsId, setSaveAsId] = useState('');
	/** Pathways must be confirmed before legend details are filled from extract. */
	const [pathwaysConfirmed, setPathwaysConfirmed] = useState(false);
	const editable = Boolean(onSave || onSaveAsNew);
	/** Latest extract rows — profile fetch must not close over a stale empty list. */
	const legendItemsRef = useRef(legendItems);
	legendItemsRef.current = legendItems;
	const validPathways = draft.imagePathways.filter((p) => p.id.trim());

	useEffect(() => {
		let cancelled = false;
		setLoadError(null);
		setPathwaysConfirmed(false);
		if (!id) {
			setDraft(draftFromProfile(null));
			return;
		}
		void (async () => {
			try {
				const res = await fetchStyleGuideProfile(id);
				if (cancelled) return;
				const next = draftFromProfile(res.profile, res.profile.markdown || '');
				// Load pathway catalog + profile metadata only; legend rows wait until
				// the operator confirms pathways (avoids filling details too early).
				setDraft({
					...next,
					stableIds: [],
				});
				setSaveAsId('');
			} catch (err) {
				if (cancelled) return;
				setDraft(draftFromProfile(active));
				setLoadError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id, active]);

	useEffect(() => {
		if (!pathwaysConfirmed || !legendItems.length) return;
		setDraft((prev) => ({
			...prev,
			stableIds: mergeLegendDetails(prev.stableIds, legendItems, prev.imagePathways),
		}));
	}, [legendItems, bust, pathwaysConfirmed]);

	/**
	 * Lock in the pathway catalog and populate legend details from extract.
	 */
	function confirmPathways() {
		if (validPathways.length === 0) return;
		setPathwaysConfirmed(true);
		const extracted = legendItemsRef.current;
		setDraft((prev) => ({
			...prev,
			imagePathways: prev.imagePathways
				.map((p) => ({ id: p.id.trim(), label: (p.label || p.id).trim() }))
				.filter((p) => p.id),
			stableIds: extracted.length
				? mergeLegendDetails(prev.stableIds, extracted, prev.imagePathways)
				: [],
		}));
	}
	if (variant === 'compact') {
		const brief = active?.uiBrief;
		return (
			<div className="style-guide-compact" title={active?.summary || ''}>
				<label className="muted">
					Style guide{' '}
					<select
						value={id}
						disabled={busy || profiles.length === 0}
						onChange={(e) => onSelect(e.target.value)}
					>
						{profiles.map((p) => (
							<option key={p.id} value={p.id}>
								{p.title}
								{p.version ? ` · v${p.version}` : ''}
							</option>
						))}
					</select>
				</label>
				{brief?.headline && <span className="muted style-guide-headline">{brief.headline}</span>}
			</div>
		);
	}

	/**
	 * Patch one field on the draft.
	 * @param patch - Partial draft update
	 */
	function patchDraft(patch: Partial<Draft>) {
		setDraft((prev) => ({ ...prev, ...patch }));
	}

	/**
	 * Patch one stable layer row.
	 * @param index - Row index
	 * @param patch - Fields to merge
	 */
	function patchLayer(index: number, patch: Partial<StableLayerRow>) {
		setDraft((prev) => ({
			...prev,
			stableIds: prev.stableIds.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		}));
	}

	const pathwayLayersBlock = (
		<div className="legend-details-panel pathway-layers-panel style-guide-editor-full">
			<h3 className="legend-details-title">Image pathway layers (exposure composites)</h3>
			<p className="muted" style={{ margin: '0.25rem 0 0.65rem' }}>
				Add, rename, or remove the exposure pathways for this figure first. Confirm them
				before legend details are filled — each legend item then picks from this list.
			</p>
			<div className="style-guide-layer-table pathway-layers-table">
				<div className="style-guide-layer-row style-guide-layer-row--pathway style-guide-layer-row--head muted">
					<span>Pathway id</span>
					<span>Label</span>
					{editable ? <span /> : null}
				</div>
				{draft.imagePathways.map((row, index) => (
					<div key={`pathway-${index}`} className="style-guide-layer-row style-guide-layer-row--pathway">
						<input
							placeholder="pathway-id"
							value={row.id}
							disabled={busy || !editable || pathwaysConfirmed}
							onChange={(e) => {
								setPathwaysConfirmed(false);
								setDraft((prev) => ({
									...prev,
									imagePathways: prev.imagePathways.map((p, i) =>
										i === index ? { ...p, id: e.target.value } : p,
									),
									stableIds: [],
								}));
							}}
							aria-label={`Pathway id ${index + 1}`}
						/>
						<input
							placeholder="label"
							value={row.label}
							disabled={busy || !editable || pathwaysConfirmed}
							onChange={(e) => {
								setPathwaysConfirmed(false);
								setDraft((prev) => ({
									...prev,
									imagePathways: prev.imagePathways.map((p, i) =>
										i === index ? { ...p, label: e.target.value } : p,
									),
								}));
							}}
							aria-label={`Pathway label ${index + 1}`}
						/>
						{editable ? (
							<button
								type="button"
								disabled={busy || pathwaysConfirmed}
								onClick={() => {
									setPathwaysConfirmed(false);
									setDraft((prev) => ({
										...prev,
										imagePathways: prev.imagePathways.filter((_, i) => i !== index),
										stableIds: [],
									}));
								}}
							>
								Remove
							</button>
						) : null}
					</div>
				))}
			</div>
			{editable && (
				<div className="pathway-layers-actions">
					<button
						type="button"
						disabled={busy || pathwaysConfirmed}
						onClick={() => {
							setPathwaysConfirmed(false);
							setDraft((prev) => ({
								...prev,
								imagePathways: [...prev.imagePathways, { id: '', label: '' }],
								stableIds: [],
							}));
						}}
					>
						Add pathway layer
					</button>
					{pathwaysConfirmed ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setPathwaysConfirmed(false);
								setDraft((prev) => ({ ...prev, stableIds: [] }));
							}}
						>
							Edit pathways
						</button>
					) : (
						<button
							type="button"
							className="primary"
							disabled={busy || validPathways.length === 0}
							onClick={confirmPathways}
						>
							Confirm pathways
						</button>
					)}
					{pathwaysConfirmed && (
						<span className="muted">
							{validPathways.length} pathway{validPathways.length === 1 ? '' : 's'} confirmed
						</span>
					)}
				</div>
			)}
		</div>
	);

	const legendDetailsBlock = (
		<div className="legend-details-panel style-guide-editor-full">
			<h3 className="legend-details-title">Legend Details</h3>
			<p className="muted" style={{ margin: '0.25rem 0 0.65rem' }}>
				{!pathwaysConfirmed
					? 'Confirm image pathway layers above first. Legend items stay empty until then.'
					: legendItems.length === 0
						? 'Waiting for legend text extraction…'
						: `Auto-filled from the legend image (${legendItems.length} item${
								legendItems.length === 1 ? '' : 's'
							}). Assign each row to a pathway from the list above.`}
			</p>
			{pathwaysConfirmed ? (
				<>
					<div className="style-guide-layer-table style-guide-legend-details-table">
						<div className="style-guide-layer-row style-guide-layer-row--legend-details style-guide-layer-row--head muted">
							<span>Icon</span>
							<span>Code</span>
							<span>Name / supports</span>
							<span>Pathway layer</span>
							{editable ? <span /> : null}
						</div>
						{draft.stableIds.map((row, index) => {
							const pathwayId = row.pathways?.[0] || '';
							const code = row.legendCode || '';
							return (
								<div
									key={`${index}-${code || row.name || index}`}
									className="style-guide-layer-row style-guide-layer-row--legend-details"
								>
									{code ? (
										<img
											className="legend-details-glyph"
											src={assetUrl(`/api/assets/glyph/${code}`, bust)}
											alt={`${code} icon`}
											width={44}
											height={44}
											draggable={false}
										/>
									) : (
										<span className="legend-details-glyph legend-details-glyph--empty" />
									)}
									{editable ? (
										<input
											className="mono"
											placeholder="code"
											value={code}
											disabled={busy}
											onChange={(e) => patchLayer(index, { legendCode: e.target.value })}
											aria-label={`Legend code ${index + 1}`}
										/>
									) : (
										<strong className="mono">{code || '—'}</strong>
									)}
									<div className="legend-details-meta">
										{editable ? (
											<input
												placeholder="name"
												value={row.name || ''}
												disabled={busy}
												onChange={(e) => patchLayer(index, { name: e.target.value })}
												aria-label={`Legend name ${index + 1}`}
											/>
										) : (
											<div>{row.name || '—'}</div>
										)}
										<div className="muted">{row.supports || '—'}</div>
									</div>
									<select
										value={pathwayId}
										disabled={busy || !editable || validPathways.length === 0}
										onChange={(e) =>
											patchLayer(index, {
												pathways: e.target.value ? [e.target.value] : [],
											})
										}
										aria-label={`Pathway layer ${index + 1}`}
									>
										<option value="">—</option>
										{validPathways.map((p) => (
											<option key={p.id} value={p.id}>
												{p.label || p.id}
											</option>
										))}
									</select>
									{editable ? (
										<button
											type="button"
											disabled={busy}
											onClick={() =>
												setDraft((prev) => ({
													...prev,
													stableIds: prev.stableIds.filter((_, i) => i !== index),
												}))
											}
										>
											Remove
										</button>
									) : null}
								</div>
							);
						})}
					</div>
					{editable && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								setDraft((prev) => ({
									...prev,
									stableIds: [
										...prev.stableIds,
										{
											id: '',
											legendCode: '',
											name: '',
											group: 'highlight',
											pathways: [],
										},
									],
								}))
							}
						>
							Add legend row
						</button>
					)}
				</>
			) : null}
		</div>
	);

	return (
		<section className="panel-section style-guide-panel">
			<h2>Style guide profile</h2>
			<p className="muted">
				Select or edit the atlas style guide at startup. Legend text is extracted
				automatically from the legend image. Save updates the current profile; Save as new
				creates a catalog copy and binds this analysis to it.
			</p>
			<label className="muted">
				Profile{' '}
				<select
					value={id}
					disabled={busy || profiles.length === 0}
					onChange={(e) => onSelect(e.target.value)}
					style={{ minWidth: 280 }}
				>
					{profiles.map((p) => (
						<option key={p.id} value={p.id}>
							{p.title}
							{p.version ? ` · v${p.version}` : ''}
						</option>
					))}
				</select>
			</label>
			{loadError && <p className="error-banner">{loadError}</p>}

			{editable ? (
				<div className="style-guide-editor">
					{pathwayLayersBlock}
					{legendDetailsBlock}
					<label>
						Title
						<input
							value={draft.title}
							disabled={busy}
							onChange={(e) => patchDraft({ title: e.target.value })}
						/>
					</label>
					<label>
						Version
						<input
							value={draft.version}
							disabled={busy}
							onChange={(e) => patchDraft({ version: e.target.value })}
						/>
					</label>
					<label className="style-guide-editor-full">
						Summary
						<textarea
							rows={3}
							value={draft.summary}
							disabled={busy}
							onChange={(e) => patchDraft({ summary: e.target.value })}
						/>
					</label>
					<label className="style-guide-editor-full">
						Headline
						<input
							value={draft.headline}
							disabled={busy}
							onChange={(e) => patchDraft({ headline: e.target.value })}
						/>
					</label>
					<label className="style-guide-editor-full">
						Layer naming convention
						<input
							value={draft.convention}
							disabled={busy}
							onChange={(e) => patchDraft({ convention: e.target.value })}
						/>
					</label>

					<label className="style-guide-editor-full">
						Illustration framework (one per line)
						<textarea
							rows={4}
							value={draft.frameworkText}
							disabled={busy}
							onChange={(e) => patchDraft({ frameworkText: e.target.value })}
						/>
					</label>
					<label className="style-guide-editor-full">
						Agent instructions (one per line)
						<textarea
							rows={4}
							value={draft.agentText}
							disabled={busy}
							onChange={(e) => patchDraft({ agentText: e.target.value })}
						/>
					</label>
					<details className="style-guide-editor-full">
						<summary>Ontology JSON</summary>
						<textarea
							rows={10}
							className="mono"
							value={draft.ontologyJson}
							disabled={busy}
							onChange={(e) => patchDraft({ ontologyJson: e.target.value })}
						/>
					</details>
					<details className="style-guide-editor-full">
						<summary>Markdown source</summary>
						<textarea
							rows={10}
							className="mono"
							value={draft.markdown}
							disabled={busy}
							onChange={(e) => patchDraft({ markdown: e.target.value })}
						/>
						{active?.markdownRel && (
							<p className="mono muted">Source: {active.markdownRel}</p>
						)}
					</details>

					<div className="style-guide-save-row">
						<button
							type="button"
							className="primary"
							disabled={busy || !id || !onSave}
							onClick={() => {
								if (!id || !onSave) return;
								onSave(id, profileFromDraft(draft, id), draft.markdown);
							}}
						>
							Save (update current)
						</button>
						<label className="muted">
							New id{' '}
							<input
								placeholder="optional-kebab-id"
								value={saveAsId}
								disabled={busy}
								onChange={(e) => setSaveAsId(e.target.value)}
								style={{ minWidth: 160 }}
							/>
						</label>
						<button
							type="button"
							disabled={busy || !onSaveAsNew}
							onClick={() => {
								if (!onSaveAsNew) return;
								const newId = saveAsId.trim() || undefined;
								const stamped = profileFromDraft(draft, newId || 'new-style-guide');
								onSaveAsNew(stamped, { id: newId, markdown: draft.markdown });
							}}
						>
							Save as new
						</button>
					</div>
				</div>
			) : (
				active && (
					<div className="style-guide-brief">
						{pathwayLayersBlock}
						{legendDetailsBlock}
						<p className="style-guide-summary">{active.summary}</p>
						{active.markdownRel && (
							<p className="mono muted">Source: {active.markdownRel}</p>
						)}
					</div>
				)
			)}
		</section>
	);
}

