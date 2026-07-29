import { useEffect, useMemo, useRef, useState } from 'react';
import type { LegendItemRow, StyleGuideProfileBrief, StyleGuideProfileSummary } from '../types';
import { assetUrl } from '../api';
import { StyleGuidePanel } from './StyleGuidePanel';

/** Owner-facing Tier-1 observability prompt shown after extract. */
export const TIER1_INSTRUCTION =
	'Top tier (obvious to see; find with high confidence first): Exact legend replicas in the diagram. (A structure may match the legend exactly but still be absent from the figure — do not search those.)';

/** Sub-tiers that apply when an item is marked Tier 1. */
const TIER1_SUB_TIERS = ['exact-replica', 'exact-replica-absent'] as const;

type Props = {
	items: LegendItemRow[];
	subTiers: string[];
	iconInterpretations: string[];
	guidelines?: string;
	busy: boolean;
	bust: number;
	analysisName: string | null;
	/** Persist a new analysis name immediately (blur / Enter). */
	onRenameAnalysis: (name: string) => void;
	cutawayExists: boolean;
	legendExists: boolean;
	styleGuideProfiles: StyleGuideProfileSummary[];
	styleGuideProfile: StyleGuideProfileBrief | null;
	styleGuideProfileId: string | null | undefined;
	onSelectStyleGuide: (profileId: string) => void;
	onSaveStyleGuide: (
		profileId: string,
		profile: Record<string, unknown>,
		markdown: string,
	) => void;
	onSaveStyleGuideAsNew: (
		profile: Record<string, unknown>,
		opts: { id?: string; markdown: string },
	) => void;
	onUploadImages: (cutaway: File | null, legend: File | null, name?: string) => void;
	/** Auto-run OCR extract when the legend image is ready. */
	onExtract: () => void | Promise<unknown>;
	onChange: (code: string, patch: Partial<LegendItemRow>) => void;
	onSaveAll: () => void;
	onFinish: () => void;
	onHome: () => void;
};

/**
 * New-analysis wizard: images + auto legend extract → Tier-1-only classification.
 */
export function ClassifyWizard({
	items,
	iconInterpretations,
	busy,
	bust,
	analysisName,
	onRenameAnalysis,
	cutawayExists,
	legendExists,
	styleGuideProfiles,
	styleGuideProfile,
	styleGuideProfileId,
	onSelectStyleGuide,
	onSaveStyleGuide,
	onSaveStyleGuideAsNew,
	onUploadImages,
	onExtract,
	onChange,
	onSaveAll,
	onFinish,
	onHome,
}: Props) {
	const [step, setStep] = useState<'images' | 'classify'>(
		cutawayExists && legendExists && items.length > 0 ? 'classify' : 'images',
	);
	const [name, setName] = useState(analysisName || '');
	/** Saved name this field was last synced to (re-syncs on external renames). */
	const [syncedName, setSyncedName] = useState(analysisName || '');
	const extractRequestedFor = useRef<string | null>(null);
	const onExtractRef = useRef(onExtract);
	onExtractRef.current = onExtract;

	if ((analysisName || '') !== syncedName) {
		setSyncedName(analysisName || '');
		setName(analysisName || '');
	}

	/**
	 * Persist the typed name, or snap back to the saved one when left blank.
	 */
	function commitName() {
		const trimmed = name.trim();
		if (!trimmed) {
			setName(analysisName || '');
			return;
		}
		if (trimmed === (analysisName || '')) return;
		onRenameAnalysis(trimmed);
	}

	const tier1Items = useMemo(() => items.filter((i) => i.tier === 1), [items]);
	const tier1Ready = useMemo(
		() =>
			tier1Items.filter(
				(i) =>
					i.subTier &&
					TIER1_SUB_TIERS.includes(i.subTier as (typeof TIER1_SUB_TIERS)[number]) &&
					i.iconInterpretation,
			).length,
		[tier1Items],
	);
	const canEnterRefine = tier1Items.length > 0 && tier1Ready === tier1Items.length;
	const canContinue = !busy && cutawayExists && legendExists && items.length > 0;
	/**
	 * Auto-extract runs once per legend. Deliberately not keyed on `bust`: extract
	 * itself invalidates the asset token, so a bust-keyed guard re-fires the job
	 * forever whenever a legend yields zero rows. Picking a new legend file resets
	 * the guard explicitly instead.
	 */
	const extractKey = legendExists ? 'legend' : 'none';

	/**
	 * Auto-extract legend text whenever a legend image is present and rows are empty.
	 */
	useEffect(() => {
		if (step !== 'images' || !legendExists || busy) return;
		if (items.length > 0) return;
		if (extractRequestedFor.current === extractKey) return;
		extractRequestedFor.current = extractKey;
		void onExtractRef.current();
	}, [step, legendExists, busy, items.length, extractKey]);

	return (
		<div className="wizard">
			<header className="topbar">
				<div>
					<h1>
						{step === 'images' ? '1. Name + profile + images' : '2. Tier 1 classification'}
						<span className="tag">Wizard</span>
					</h1>
					<label className="wizard-name">
						Analysis name
						<input
							value={name}
							placeholder="e.g. Cohort figure v2"
							onChange={(e) => setName(e.target.value)}
							onBlur={commitName}
							onKeyDown={(e) => {
								// Blur commits; committing here too would double-send the rename.
								if (e.key === 'Enter') {
									e.preventDefault();
									e.currentTarget.blur();
								}
							}}
						/>
					</label>
				</div>
				<button type="button" disabled={busy} onClick={onHome}>
					← Analyses
				</button>
			</header>

			{step === 'images' ? (
				<div className="wizard-body">
					<section className="panel-section">
						<h2>Load cutaway + legend</h2>
						<p className="muted">
							Upload the LAYER MAP cutaway and legend. Legend text and icons are extracted
							automatically; Continue opens when both images and extract are ready.
						</p>
						<div className="row" style={{ marginTop: '0.75rem' }}>
							<label className="muted">
								Cutaway{' '}
								<input
									type="file"
									accept="image/png,image/jpeg"
									disabled={busy}
									onChange={(e) =>
										onUploadImages(e.target.files?.[0] ?? null, null, name || undefined)
									}
								/>
							</label>
							<label className="muted">
								Legend{' '}
								<input
									type="file"
									accept="image/png,image/jpeg"
									disabled={busy}
									onChange={(e) => {
										extractRequestedFor.current = null;
										onUploadImages(null, e.target.files?.[0] ?? null, name || undefined);
									}}
								/>
							</label>
						</div>
						<p className="mono muted">
							cutaway: {cutawayExists ? 'ready' : 'missing'} · legend:{' '}
							{legendExists ? 'ready' : 'missing'}
							{legendExists
								? items.length > 0
									? ` · extract: ${items.length} items`
									: busy
										? ' · extracting…'
										: ' · extract pending'
								: ''}
						</p>
						<div className="wizard-previews">
							{cutawayExists && (
								<a
									className="wizard-thumb"
									href={assetUrl('/api/assets/cutaway', bust)}
									target="_blank"
									rel="noreferrer"
									title="Open cutaway at full size"
								>
									<img src={assetUrl('/api/assets/cutaway', bust)} alt="Cutaway thumbnail" />
									<span className="muted">Cutaway</span>
								</a>
							)}
							{legendExists && (
								<a
									className="wizard-thumb"
									href={assetUrl('/api/assets/legend', bust)}
									target="_blank"
									rel="noreferrer"
									title="Open legend at full size"
								>
									<img src={assetUrl('/api/assets/legend', bust)} alt="Legend thumbnail" />
									<span className="muted">Legend</span>
								</a>
							)}
						</div>
					</section>

					<StyleGuidePanel
						profiles={styleGuideProfiles}
						active={styleGuideProfile}
						selectedId={styleGuideProfileId}
						busy={busy}
						bust={bust}
						legendItems={items}
						onSelect={onSelectStyleGuide}
						onSave={onSaveStyleGuide}
						onSaveAsNew={onSaveStyleGuideAsNew}
					/>

					<section className="panel-section">
						<div className="row" style={{ marginTop: '0.25rem' }}>
							<button
								type="button"
								className="primary"
								disabled={!canContinue}
								onClick={() => setStep('classify')}
								title={
									canContinue
										? 'Continue to Tier 1 classification'
										: 'Waiting for cutaway, legend, and automatic extract'
								}
							>
								Continue to Tier 1 →
							</button>
						</div>
					</section>
				</div>
			) : (
				<div className="wizard-body wizard-classify">
					<aside className="panel">
						<div className="panel-section">
							<h2>Tier 1 only</h2>
							<div className="tier1-instruction" role="note">
								{TIER1_INSTRUCTION}
							</div>
							{styleGuideProfile && (
								<p className="muted">
									Style guide: <strong>{styleGuideProfile.title}</strong>
								</p>
							)}
							<p className="muted">
								Mark exact-replica items as Tier 1, then set sub-tier and icon interpretation.
								Other rows stay for later tiers. Ready {tier1Ready}/{tier1Items.length || 0}{' '}
								Tier 1 item{tier1Items.length === 1 ? '' : 's'}.
							</p>
							<div className="row">
								<button type="button" disabled={busy} onClick={() => setStep('images')}>
									← Profile
								</button>
								<button type="button" disabled={busy} onClick={onSaveAll}>
									Save classifications
								</button>
								<button
									type="button"
									className="primary"
									disabled={busy || !canEnterRefine}
									onClick={onFinish}
									title={
										canEnterRefine
											? 'Save Tier 1 and run template match'
											: 'Mark at least one Tier 1 item with sub-tier + icon interpretation'
									}
								>
									Run Tier 1 match →
								</button>
							</div>
						</div>
					</aside>
					<div className="wizard-grid">
						{items.map((it) => {
							const isTier1 = it.tier === 1;
							return (
								<article
									key={it.code}
									className={`classify-card${isTier1 ? ' classify-card--tier1' : ''}`}
								>
									<header>
										<strong>
											{it.code} · {it.name}
										</strong>
										<div className="muted">
											{it.location || '—'} · {it.supports || '—'}
										</div>
									</header>
									{it.glyph_path && (
										<img
											src={assetUrl(`/api/assets/glyph/${it.code}`, bust)}
											alt={`${it.code} glyph`}
											className="glyph"
										/>
									)}
									<label>
										Tier 1?
										<select
											value={isTier1 ? '1' : ''}
											disabled={busy}
											onChange={(e) => {
												if (e.target.value === '1') {
													onChange(it.code, {
														tier: 1,
														searchable: true,
														subTier:
															it.subTier &&
															TIER1_SUB_TIERS.includes(
																it.subTier as (typeof TIER1_SUB_TIERS)[number],
															)
																? it.subTier
																: 'exact-replica',
														iconInterpretation: it.iconInterpretation || '1-discrete',
													});
												} else {
													onChange(it.code, {
														tier: null,
														searchable: false,
														subTier: null,
													});
												}
											}}
										>
											<option value="">Later (not Tier 1)</option>
											<option value="1">Yes — Tier 1</option>
										</select>
									</label>
									{isTier1 && (
										<>
											<label>
												Sub-tier
												<select
													value={it.subTier ?? ''}
													disabled={busy}
													onChange={(e) =>
														onChange(it.code, { subTier: e.target.value || null })
													}
												>
													<option value="">—</option>
													{TIER1_SUB_TIERS.map((s) => (
														<option key={s} value={s}>
															{s}
														</option>
													))}
												</select>
											</label>
											<label>
												Icon interpretation
												<select
													value={it.iconInterpretation || '1-discrete'}
													disabled={busy}
													onChange={(e) =>
														onChange(it.code, { iconInterpretation: e.target.value })
													}
												>
													{iconInterpretations.map((s) => (
														<option key={s} value={s}>
															{s}
														</option>
													))}
												</select>
											</label>
										</>
									)}
								</article>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
