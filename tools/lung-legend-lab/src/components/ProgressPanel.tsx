import type { FindingsDb, JobState, TierStats } from '../types';

type Props = {
	findings: FindingsDb | null;
	job: JobState | null;
};

/**
 * Read a tier stats block safely from the findings DB.
 * @param findings - Findings database
 * @param key - Stats key such as tier1
 */
function tierStats(findings: FindingsDb | null, key: string): TierStats {
	const raw = findings?.stats?.[key];
	if (raw && typeof raw === 'object') return raw as TierStats;
	return {};
}

/**
 * Progress / stats panel: tier counts, run history, live job log.
 */
export function ProgressPanel({ findings, job }: Props) {
	const t1 = tierStats(findings, 'tier1');
	const t2 = tierStats(findings, 'tier2');
	const t3 = tierStats(findings, 'tier3');
	const t0 = tierStats(findings, 'tier0');
	const runs = [...(findings?.runs || [])].reverse().slice(0, 8);

	return (
		<>
			<div className="panel-section">
				<h2>Progress</h2>
				<p className="muted">{findings?.meta?.phase || 'No findings DB yet — run match.'}</p>
				<p className="mono muted">
					updated {findings?.meta?.updatedAt || '—'} · run {findings?.meta?.runId || '—'}
				</p>
				<div className="stats-grid">
					<div className="stat">
						<div className="label">Tier 1 found / expected</div>
						<div className="value">
							{t1.found ?? 0}/{t1.expected ?? 0}
						</div>
					</div>
					<div className="stat">
						<div className="label">Tier 1 mean best</div>
						<div className="value">
							{t1.meanBestScore != null ? t1.meanBestScore.toFixed(3) : '—'}
						</div>
					</div>
					<div className="stat">
						<div className="label">T1 instances</div>
						<div className="value">{t1.instanceTotal ?? 0}</div>
					</div>
					<div className="stat">
						<div className="label">T2 / T3 / skip</div>
						<div className="value">
							{t2.found ?? 0}/{t3.found ?? 0}/{t0.skipped ?? 0}
						</div>
					</div>
				</div>
			</div>

			<div className="panel-section">
				<h2>Run history</h2>
				{runs.length === 0 ? (
					<p className="muted">No runs recorded yet.</p>
				) : (
					<ul className="run-list">
						{runs.map((r) => (
							<li key={r.runId}>
								<div className="mono">{r.timestamp}</div>
								<div className="muted">
									{r.source} · t1_mean=
									{r.tier1_mean_score != null ? r.tier1_mean_score.toFixed(3) : '—'}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="panel-section">
				<h2>Job log</h2>
				{job ? (
					<>
						<p className="muted">
							{job.kind} · <strong>{job.status}</strong>
							{job.error ? ` · ${job.error}` : ''}
						</p>
						<pre className="job-log">{(job.logTail || job.log || []).join('\n')}</pre>
					</>
				) : (
					<p className="muted">Idle — run match to see progress.</p>
				)}
			</div>
		</>
	);
}
