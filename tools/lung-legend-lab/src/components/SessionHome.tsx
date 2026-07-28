import type { AnalysisSummary } from '../types';

type Props = {
	analyses: AnalysisSummary[];
	busy: boolean;
	onOpen: (id: string) => void;
	onNew: () => void;
	onSeedCurrent: () => void;
};

/**
 * Home screen: load a saved analysis or start a new one.
 */
export function SessionHome({ analyses, busy, onOpen, onNew, onSeedCurrent }: Props) {
	return (
		<div className="home-screen">
			<div className="home-card">
				<h1>Lung Legend Lab</h1>
				<p className="muted">
					Saved image analyses for template-match refinement. Maintainer only — not public
					site.
				</p>
				<div className="row" style={{ marginTop: '1rem' }}>
					<button type="button" className="primary" disabled={busy} onClick={onNew}>
						Start new analysis
					</button>
					<button type="button" disabled={busy} onClick={onSeedCurrent}>
						Save / open current cutaway
					</button>
				</div>
			</div>

			<div className="home-card">
				<h2>Saved analyses</h2>
				{analyses.length === 0 ? (
					<p className="muted">No saved analyses yet.</p>
				) : (
					<ul className="analysis-list">
						{analyses.map((a) => (
							<li key={a.id}>
								<div>
									<strong>{a.name}</strong>
									<div className="muted mono">
										{a.id} · {a.phase} · updated {a.updatedAt}
									</div>
									<div className="muted">
										T1 {a.tier1Found ?? '—'}/{a.tier1Expected ?? '—'} · instances{' '}
										{a.tier1Instances ?? '—'} ·{' '}
										{a.hasClassification ? 'classified' : 'needs classification'}
									</div>
								</div>
								<button type="button" disabled={busy} onClick={() => onOpen(a.id)}>
									Open
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
