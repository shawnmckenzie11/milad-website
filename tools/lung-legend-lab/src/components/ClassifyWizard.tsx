import { useMemo, useState } from 'react';
import type { LegendItemRow } from '../types';
import { assetUrl } from '../api';

type Props = {
	items: LegendItemRow[];
	subTiers: string[];
	iconInterpretations: string[];
	guidelines?: string;
	busy: boolean;
	bust: number;
	analysisName: string | null;
	cutawayExists: boolean;
	legendExists: boolean;
	onUploadImages: (cutaway: File | null, legend: File | null, name?: string) => void;
	onExtract: () => void;
	onChange: (code: string, patch: Partial<LegendItemRow>) => void;
	onSaveAll: () => void;
	onFinish: () => void;
	onHome: () => void;
};

/**
 * New-analysis wizard: images first, then legend-item classification.
 * Kept off the refine dashboard so matching work has full real estate.
 */
export function ClassifyWizard({
	items,
	subTiers,
	iconInterpretations,
	guidelines,
	busy,
	bust,
	analysisName,
	cutawayExists,
	legendExists,
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
	const classified = useMemo(
		() => items.filter((i) => i.tier !== null && i.subTier).length,
		[items],
	);

	return (
		<div className="wizard">
			<header className="topbar">
				<div>
					<h1>
						New analysis · {step === 'images' ? '1. Images' : '2. Classification'}
						<span className="tag">Wizard</span>
					</h1>
					<div className="meta">{analysisName || 'Untitled'}</div>
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
							Upload the two LAYER MAP inputs (or use files already on the session). Then
							extract legend text before classifying.
						</p>
						<label className="muted">
							Analysis name{' '}
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Cohort figure v2"
								style={{ minWidth: 240 }}
							/>
						</label>
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
									onChange={(e) =>
										onUploadImages(null, e.target.files?.[0] ?? null, name || undefined)
									}
								/>
							</label>
						</div>
						<p className="mono muted">
							cutaway: {cutawayExists ? 'ready' : 'missing'} · legend:{' '}
							{legendExists ? 'ready' : 'missing'}
						</p>
						<div className="wizard-previews">
							{cutawayExists && (
								<img src={assetUrl('/api/assets/cutaway', bust)} alt="Cutaway preview" />
							)}
							{legendExists && (
								<img src={assetUrl('/api/assets/legend', bust)} alt="Legend preview" />
							)}
						</div>
						<div className="row" style={{ marginTop: '1rem' }}>
							<button
								type="button"
								disabled={busy || !legendExists}
								onClick={onExtract}
							>
								Extract legend text
							</button>
							<button
								type="button"
								className="primary"
								disabled={busy || !cutawayExists || !legendExists || items.length === 0}
								onClick={() => setStep('classify')}
							>
								Continue to classification →
							</button>
						</div>
					</section>
				</div>
			) : (
				<div className="wizard-body wizard-classify">
					<aside className="panel">
						<div className="panel-section">
							<h2>Tier criteria</h2>
							<pre className="guidelines">{guidelines || 'Load extract to see guidelines.'}</pre>
							<p className="muted">
								Classified {classified}/{items.length}. Icon interpretation matters for
								side-by-side glyphs (e.g. B6 → 2-discrete).
							</p>
							<div className="row">
								<button type="button" disabled={busy} onClick={() => setStep('images')}>
									← Images
								</button>
								<button type="button" disabled={busy} onClick={onSaveAll}>
									Save classifications
								</button>
								<button
									type="button"
									className="primary"
									disabled={busy || classified < items.length}
									onClick={onFinish}
								>
									Enter refinement →
								</button>
							</div>
						</div>
					</aside>
					<div className="wizard-grid">
						{items.map((it) => (
							<article key={it.code} className="classify-card">
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
									Tier
									<select
										value={it.tier ?? ''}
										onChange={(e) =>
											onChange(it.code, {
												tier: e.target.value === '' ? null : Number(e.target.value),
												searchable:
													e.target.value === '' ? false : Number(e.target.value) > 0,
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
										onChange={(e) => onChange(it.code, { subTier: e.target.value || null })}
									>
										<option value="">—</option>
										{subTiers.map((s) => (
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
							</article>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
