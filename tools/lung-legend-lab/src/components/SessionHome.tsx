import { useState } from 'react';
import type { AnalysisSummary } from '../types';

type Props = {
	analyses: AnalysisSummary[];
	busy: boolean;
	onOpen: (id: string) => void;
	/** Create a new analysis, named at creation time when a name was typed. */
	onNew: (name?: string) => void;
	/** Rename a saved analysis (persisted immediately). */
	onRename: (id: string, name: string) => void;
	/** Permanently delete a saved analysis (confirm in this view). */
	onDelete: (id: string) => void;
};

/**
 * Home screen: load a saved analysis or start a new one.
 */
export function SessionHome({ analyses, busy, onOpen, onNew, onRename, onDelete }: Props) {
	const [newName, setNewName] = useState('');

	/**
	 * Create the analysis with the typed name (server default applies when blank).
	 */
	function handleNew() {
		if (busy) return;
		const trimmed = newName.trim();
		onNew(trimmed || undefined);
		setNewName('');
	}

	/**
	 * Prompt for a new name and persist it if the maintainer changed it.
	 * @param a - Analysis summary
	 */
	function handleRename(a: AnalysisSummary) {
		const next = window.prompt(`Rename analysis “${a.name}”`, a.name);
		if (next == null) return;
		const trimmed = next.trim();
		if (!trimmed || trimmed === a.name) return;
		onRename(a.id, trimmed);
	}

	/**
	 * Confirm and delete an analysis from the full list view.
	 * @param a - Analysis summary
	 */
	function handleDelete(a: AnalysisSummary) {
		const ok = window.confirm(
			`Delete analysis “${a.name}”?\n\n${a.id}\n\nThis cannot be undone.`,
		);
		if (!ok) return;
		onDelete(a.id);
	}

	return (
		<div className="home-screen">
			<div className="home-card">
				<h1>Lung Legend Lab</h1>
				<p className="muted">
					Saved image analyses for template-match refinement. Maintainer only — not public
					site.
				</p>
				<div className="new-analysis-start">
					<label className="new-analysis-name">
						Analysis name
						<input
							value={newName}
							disabled={busy}
							placeholder="e.g. Cohort figure v2"
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleNew();
							}}
						/>
					</label>
					<button type="button" className="primary" disabled={busy} onClick={handleNew}>
						Start new analysis
					</button>
					<p className="muted new-analysis-hint">
						Saved with the analysis on create. Leave blank for “New analysis”; you can
						rename it any time from the wizard header.
					</p>
				</div>
			</div>

			<div className="home-card">
				<h2>Saved analyses</h2>
				{analyses.length === 0 ? (
					<p className="muted">No saved analyses yet.</p>
				) : (
					<ul className="analysis-list">
						{analyses.map((a) => {
							const currentTier =
								typeof a.tierToTest === 'number' && a.tierToTest >= 1 ? a.tierToTest : 1;
							const unlocked =
								typeof a.maxUnlockedTier === 'number' && a.maxUnlockedTier >= 1
									? a.maxUnlockedTier
									: currentTier;
							return (
							<li key={a.id}>
								<div>
									<strong>{a.name}</strong>
									<div className="muted mono">
										{a.id} · {a.phase} · updated {a.updatedAt}
									</div>
									<div className="analysis-tier-badge" title="Current Tier to Test">
										<span className="analysis-tier-badge__label">
											Tier {currentTier}
										</span>
										<span className="muted">
											{' '}
											· unlocked through Tier {unlocked}
										</span>
									</div>
									<div className="muted">
										T1 {a.tier1Found ?? '—'}/{a.tier1Expected ?? '—'} · instances{' '}
										{a.tier1Instances ?? '—'} ·{' '}
										{a.hasClassification ? 'classified' : 'needs classification'}
									</div>
								</div>
								<div className="analysis-list-actions">
									<button type="button" disabled={busy} onClick={() => onOpen(a.id)}>
										Open
									</button>
									<button type="button" disabled={busy} onClick={() => handleRename(a)}>
										Rename
									</button>
									<button
										type="button"
										className="analysis-delete-btn"
										disabled={busy}
										onClick={() => handleDelete(a)}
									>
										Delete
									</button>
								</div>
							</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
