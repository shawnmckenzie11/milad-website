import { useState } from 'react';
import type {
	LegendItemRow,
	StyleGuideProfileBrief,
	StyleGuideProfileSummary,
} from '../types';
import { assetUrl } from '../api';
import { StyleGuidePanel } from './StyleGuidePanel';

/** Tier-2 owner prompt for Legend View after Tier 1 Complete. */
export const TIER2_INSTRUCTION =
	'Assign each remaining legend item to Tier 2: choose Yes, then set its sub-tier and icon interpretation. When every Tier 2 row is ready, save to run match.';

/** Sub-tiers allowed when assigning Tier 2. */
const TIER2_SUB_TIERS = [
	'explicitly-present',
	'partial-neighbor-similarity',
] as const;

type LegendTab = 'icons' | 'style';

type Props = {
	items: LegendItemRow[];
	iconInterpretations: string[];
	guidelines?: string;
	busy: boolean;
	bust: number;
	styleGuideProfiles: StyleGuideProfileSummary[];
	styleGuideProfile: StyleGuideProfileBrief | null;
	styleGuideProfileId: string | null | undefined;
	/** Persist the selected style-guide profile for this analysis. */
	onStyleGuideSelect: (profileId: string) => void;
	onSaveStyleGuide: (
		profileId: string,
		profile: Record<string, unknown>,
		markdown: string,
	) => void;
	onSaveStyleGuideAsNew: (
		profile: Record<string, unknown>,
		opts: { id?: string; markdown: string },
	) => void;
	/** When `tier2`, only non–Tier-1 rows are assignable; Tier-1 rows are locked. */
	mode?: 'all' | 'tier2';
	onChange: (code: string, patch: Partial<LegendItemRow>) => void;
	onSaveAll: () => void;
};

/**
 * Inline lock glyph for legend cards that belong to a completed / locked tier.
 */
function LockIcon() {
	return (
		<svg
			className="classify-card__lock"
			width="14"
			height="14"
			viewBox="0 0 16 16"
			aria-hidden="true"
			focusable="false"
		>
			<path
				fill="currentColor"
				d="M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3zm2 5H6V4a2 2 0 1 1 4 0v2z"
			/>
		</svg>
	);
}

/**
 * Legend View: legend-icon classification (default tab) and a separate Style guide tab.
 */
export function LegendViewPage({
	items,
	iconInterpretations,
	guidelines,
	busy,
	bust,
	styleGuideProfiles,
	styleGuideProfile,
	styleGuideProfileId,
	onStyleGuideSelect,
	onSaveStyleGuide,
	onSaveStyleGuideAsNew,
	mode = 'all',
	onChange,
	onSaveAll,
}: Props) {
	/** Always open on legend icons when this view mounts. */
	const [tab, setTab] = useState<LegendTab>('icons');
	const tier2Mode = mode === 'tier2';
	const assignable = tier2Mode ? items.filter((i) => i.tier !== 1) : items;
	const lockedTier1 = tier2Mode ? items.filter((i) => i.tier === 1) : [];
	const gridItems = tier2Mode ? [...lockedTier1, ...assignable] : items;
	const tier2Ready = assignable.filter(
		(i) =>
			i.tier === 2 &&
			i.subTier &&
			TIER2_SUB_TIERS.includes(i.subTier as (typeof TIER2_SUB_TIERS)[number]) &&
			i.iconInterpretation,
	).length;
	const canSaveRun =
		!tier2Mode ||
		(assignable.some((i) => i.tier === 2) &&
			assignable.filter((i) => i.tier === 2).every(
				(i) =>
					i.subTier &&
					TIER2_SUB_TIERS.includes(i.subTier as (typeof TIER2_SUB_TIERS)[number]) &&
					i.iconInterpretation,
			));

	return (
		<div className="legend-view-page">
			<nav className="legend-view-tabs" aria-label="Legend View sections">
				<button
					type="button"
					className={tab === 'icons' ? 'primary' : undefined}
					onClick={() => setTab('icons')}
				>
					Legend icons
				</button>
				<button
					type="button"
					className={tab === 'style' ? 'primary' : undefined}
					onClick={() => setTab('style')}
				>
					Style guide
				</button>
			</nav>

			<header className="legend-view-header">
				<div>
					<h2>{tier2Mode ? 'Legend View · Tier 2 assignment' : 'Legend View'}</h2>
					<p className="muted">
						{tab === 'style'
							? 'Select the illustration style guide for this analysis.'
							: tier2Mode
								? `Assign remaining legend rows to Tier 2 (sub-tier + icon). Ready ${tier2Ready} Tier 2 item(s).`
								: `Classify each LAYER MAP row. ${items.filter((i) => i.tier !== null && i.subTier).length}/${items.length} classified.`}
					</p>
				</div>
				{tab === 'icons' ? (
					<button
						type="button"
						className="primary"
						disabled={busy || (tier2Mode && !canSaveRun)}
						onClick={onSaveAll}
					>
						{tier2Mode ? 'Save Tier 2 & run match' : 'Save classifications'}
					</button>
				) : null}
			</header>

			{tab === 'style' ? (
				<StyleGuidePanel
					profiles={styleGuideProfiles}
					active={styleGuideProfile}
					selectedId={styleGuideProfileId}
					busy={busy}
					onSelect={onStyleGuideSelect}
					onSave={onSaveStyleGuide}
					onSaveAsNew={onSaveStyleGuideAsNew}
					legendItems={items}
					bust={bust}
				/>
			) : (
				<>
					{tier2Mode ? (
						<div className="tier1-instruction" role="note">
							{TIER2_INSTRUCTION}
						</div>
					) : (
						<details className="panel-section legend-view-guidelines">
							<summary>Tier criteria</summary>
							<pre className="guidelines">{guidelines || 'No guidelines loaded.'}</pre>
						</details>
					)}

					<div className="wizard-grid legend-view-grid">
						{gridItems.map((it) => {
							const locked = tier2Mode && it.tier === 1;
							const isTier2 = it.tier === 2;
							return (
								<article
									key={it.code}
									className={[
										'classify-card',
										locked ? 'classify-card--locked' : '',
										isTier2 ? 'classify-card--tier2' : '',
										locked ? 'classify-card--tier1' : '',
									]
										.filter(Boolean)
										.join(' ')}
								>
									<header>
										<strong>
											{locked ? <LockIcon /> : null}
											{it.code} · {it.name}
										</strong>
										<div className="muted">
											{it.location || '—'} · {it.supports || '—'}
											{it.slug ? ` · ${it.slug}` : ''}
										</div>
									</header>
									{it.glyph_path && (
										<img
											src={assetUrl(`/api/assets/glyph/${it.code}`, bust)}
											alt={`${it.code} glyph`}
											className="glyph"
										/>
									)}
									{locked ? (
										<p className="muted classify-card__locked-meta">
											Tier 1 · {it.subTier || '—'} · {it.iconInterpretation || '—'}
										</p>
									) : tier2Mode ? (
										<>
											<label>
												Tier 2?
												<select
													value={isTier2 ? '2' : ''}
													disabled={busy}
													onChange={(e) => {
														if (e.target.value === '2') {
															onChange(it.code, {
																tier: 2,
																searchable: true,
																subTier:
																	it.subTier &&
																	TIER2_SUB_TIERS.includes(
																		it.subTier as (typeof TIER2_SUB_TIERS)[number],
																	)
																		? it.subTier
																		: 'explicitly-present',
																iconInterpretation:
																	it.iconInterpretation || '1-discrete',
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
													<option value="">Later (not Tier 2 yet)</option>
													<option value="2">Yes — Tier 2</option>
												</select>
											</label>
											{isTier2 && (
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
															{TIER2_SUB_TIERS.map((s) => (
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
																onChange(it.code, {
																	iconInterpretation: e.target.value,
																})
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
										</>
									) : (
										<>
											<label>
												Tier
												<select
													value={it.tier ?? ''}
													disabled={busy}
													onChange={(e) =>
														onChange(it.code, {
															tier: e.target.value === '' ? null : Number(e.target.value),
															searchable:
																e.target.value === ''
																	? false
																	: Number(e.target.value) > 0,
														})
													}
												>
													<option value="">—</option>
													<option value="0">0 skip</option>
													<option value="1">1 high</option>
													<option value="2">2 medium</option>
													<option value="3">3 hard</option>
												</select>
											</label>
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
													<option value="exact-replica">exact-replica</option>
													<option value="exact-replica-absent">exact-replica-absent</option>
													<option value="explicitly-present">explicitly-present</option>
													<option value="partial-neighbor-similarity">
														partial-neighbor-similarity
													</option>
													<option value="fractal-scale-continuation">
														fractal-scale-continuation
													</option>
													<option value="scale-divergent-low-similarity">
														scale-divergent-low-similarity
													</option>
													<option value="not-diagrammed-in-legend">
														not-diagrammed-in-legend
													</option>
													<option value="absent-from-figure">absent-from-figure</option>
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
				</>
			)}
		</div>
	);
}
