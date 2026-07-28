import type { LegendItemRow } from '../types';
import { assetUrl } from '../api';

type Props = {
	items: LegendItemRow[];
	subTiers: string[];
	iconInterpretations: string[];
	selectedCode: string | null;
	bust: number;
	onSelect: (code: string) => void;
	onChange: (code: string, patch: Partial<LegendItemRow>) => void;
	onSave: (code: string) => void;
};

/**
 * Map a tier number to a compact CSS badge class.
 * @param tier - Observability tier 0–3
 */
function tierClass(tier: number | null): string {
	if (tier === 1) return 't1';
	if (tier === 2) return 't2';
	if (tier === 3) return 't3';
	return 't0';
}

/**
 * Legend item list with inline classification editors (tier / subTier / iconInterpretation).
 */
export function LegendItemList({
	items,
	subTiers,
	iconInterpretations,
	selectedCode,
	bust,
	onSelect,
	onChange,
	onSave,
}: Props) {
	return (
		<div className="panel-section">
			<h2>Legend items · classify</h2>
			<p className="muted">
				Seeded from known classifications; edit and save to update{' '}
				<span className="mono">legend-classification.json</span>.
			</p>
			<div className="item-list">
				{items.map((item) => (
					<article
						key={item.code}
						className={`item-card${selectedCode === item.code ? ' active' : ''}`}
						onClick={() => onSelect(item.code)}
					>
						<header>
							<span className="code">{item.code}</span>
							<span>
								<span className={`badge ${tierClass(item.tier)}`}>T{item.tier ?? '?'}</span>{' '}
								{item.status && <span className={`badge ${item.status}`}>{item.status}</span>}
							</span>
						</header>
						<div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
							{item.glyph_path && (
								<img
									src={assetUrl(`/api/assets/glyph/${item.code}`, bust)}
									alt=""
									width={36}
									height={36}
									style={{ objectFit: 'contain', background: '#fff', borderRadius: 4 }}
								/>
							)}
							<div style={{ minWidth: 0 }}>
								<div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{item.name}</div>
								<div className="muted">
									{item.location || '—'} · {item.supports || '—'}
								</div>
								<div className="mono muted">
									n={item.instanceCount} best=
									{item.bestScore != null ? item.bestScore.toFixed(3) : '—'} cum=
									{item.cumulativeFindCount}
								</div>
							</div>
						</div>
						<div className="fields" onClick={(e) => e.stopPropagation()}>
							<label>
								Tier
								<select
									value={item.tier ?? 0}
									onChange={(e) =>
										onChange(item.code, {
											tier: Number(e.target.value),
											searchable: Number(e.target.value) > 0,
										})
									}
								>
									{[0, 1, 2, 3].map((t) => (
										<option key={t} value={t}>
											{t}
										</option>
									))}
								</select>
							</label>
							<label>
								Sub-tier
								<select
									value={item.subTier ?? ''}
									onChange={(e) => onChange(item.code, { subTier: e.target.value })}
								>
									<option value="">—</option>
									{subTiers.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
								</select>
							</label>
							<label style={{ gridColumn: '1 / -1' }}>
								iconInterpretation
								<select
									value={item.iconInterpretation}
									onChange={(e) =>
										onChange(item.code, { iconInterpretation: e.target.value })
									}
								>
									{iconInterpretations.map((s) => (
										<option key={s} value={s}>
											{s}
										</option>
									))}
								</select>
							</label>
							<label>
								Searchable
								<select
									value={item.searchable ? 'yes' : 'no'}
									onChange={(e) =>
										onChange(item.code, { searchable: e.target.value === 'yes' })
									}
								>
									<option value="yes">yes</option>
									<option value="no">no</option>
								</select>
							</label>
							<div style={{ alignSelf: 'end' }}>
								<button type="button" onClick={() => onSave(item.code)}>
									Save
								</button>
							</div>
						</div>
					</article>
				))}
			</div>
		</div>
	);
}
