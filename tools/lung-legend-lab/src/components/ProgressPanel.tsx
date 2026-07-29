import type { FindingsDb, JobState, TierProgressSnapshot } from '../types';
import { pct, TIER_GOOD_CORRECT_PCT, TIER_GOOD_MAX_FP_PCT } from '../lib/tierProgress';

type Props = {
	findings: FindingsDb | null;
	job: JobState | null;
	/** Current computed progress by tier (primary Pipeline view). */
	tierProgress: TierProgressSnapshot[];
	/** Tier focused for this iteration (Tier to Test). */
	tierToTest: number;
	/** Snapshot captured immediately before the last Run Match, if any. */
	beforeProgress: TierProgressSnapshot | null;
	/** Snapshot after the last Run Match completed. */
	afterProgress: TierProgressSnapshot | null;
};

/**
 * Status chip class for a per-item tally row.
 * @param status - Item tally status
 */
function statusClass(status: string): string {
	if (status === 'correct-location') return 'tally-ok';
	if (status === 'wrong-location') return 'tally-warn';
	return 'tally-pending';
}

/**
 * Short label for a tally status.
 * @param status - Item tally status
 */
function statusLabel(status: string): string {
	if (status === 'correct-location') return 'Correct location';
	if (status === 'wrong-location') return 'Wrong location';
	return 'Still pending';
}

/**
 * Pipeline tab: progress / success by tier with tallies, graduation, and optional before/after.
 */
export function ProgressPanel({
	findings,
	job,
	tierProgress,
	tierToTest,
	beforeProgress,
	afterProgress,
}: Props) {
	const focus = tierProgress.find((t) => t.tier === tierToTest) || tierProgress[0];

	return (
		<>
			<div className="panel-section">
				<h2>Progress by tier</h2>
				<p className="muted">
					Confirmed items stay locked. Unconfirmed remain yellow outlines. Later tiers will
					need matchers refined from prior-tier conclusions — focus is still Tier 1.
				</p>
				<p
					className="muted"
					title={`Correctness = codes with ≥1 correct-location / searchable codes in tier. FP rate = archived false positives / (confirmed|reassigned + FPs) in tier. Good when correctness ≥ ${TIER_GOOD_CORRECT_PCT * 100}% and FP rate < ${TIER_GOOD_MAX_FP_PCT * 100}%.`}
				>
					Graduation: ≥{TIER_GOOD_CORRECT_PCT * 100}% codes correct-location and &lt;
					{TIER_GOOD_MAX_FP_PCT * 100}% FP among reviewed hits → marked <strong>good</strong>.
				</p>
			</div>

			{beforeProgress && afterProgress && (
				<div className="panel-section before-after">
					<h2>Before / after · Tier {tierToTest}</h2>
					<div className="stats-grid">
						<div className="stat">
							<div className="label">Correctness before → after</div>
							<div className="value">
								{pct(beforeProgress.correctnessPct)} → {pct(afterProgress.correctnessPct)}
							</div>
						</div>
						<div className="stat">
							<div className="label">FP rate before → after</div>
							<div className="value">
								{pct(beforeProgress.fpRate)} → {pct(afterProgress.fpRate)}
							</div>
						</div>
						<div className="stat">
							<div className="label">Correct codes</div>
							<div className="value">
								{beforeProgress.correctCount}/{beforeProgress.expected} →{' '}
								{afterProgress.correctCount}/{afterProgress.expected}
							</div>
						</div>
						<div className="stat">
							<div className="label">Detected instances</div>
							<div className="value">
								{beforeProgress.detectedInstances} → {afterProgress.detectedInstances}
							</div>
						</div>
					</div>
				</div>
			)}

			{tierProgress.map((tp) => (
				<div
					key={tp.tier}
					className={`panel-section tier-progress-card${tp.tier === tierToTest ? ' focus' : ''}${tp.graduation.good ? ' good' : ''}`}
				>
					<div className="row" style={{ justifyContent: 'space-between' }}>
						<h2 style={{ margin: 0 }}>{tp.label}</h2>
						<span
							className={tp.graduation.good ? 'grad-badge good' : 'grad-badge'}
							title={
								tp.graduation.good
									? 'Meets correctness and FP thresholds'
									: `Need ≥${pct(tp.graduation.thresholds.minCorrectPct)} correct and <${pct(tp.graduation.thresholds.maxFpPct)} FP`
							}
						>
							{tp.graduation.good ? 'good' : 'in progress'}
						</span>
					</div>
					<div className="stats-grid" style={{ marginTop: 8 }}>
						<div
							className="stat"
							title="Codes with ≥1 correct-location confirmation / searchable codes in this tier"
						>
							<div className="label">Correctness</div>
							<div className="value">
								{pct(tp.correctnessPct)}{' '}
								<span className="muted">
									({tp.correctCount}/{tp.expected})
								</span>
							</div>
						</div>
						<div
							className="stat"
							title="Archived false positives / (active confirmed|reassigned + archived FPs) in this tier"
						>
							<div className="label">FP rate (reviewed)</div>
							<div className="value">
								{pct(tp.fpRate)}{' '}
								<span className="muted">
									({tp.fpCount}/{tp.reviewedCount || 0})
								</span>
							</div>
						</div>
						<div className="stat">
							<div className="label">Wrong location</div>
							<div className="value">{tp.wrongCount}</div>
						</div>
						<div className="stat">
							<div className="label">Still pending</div>
							<div className="value">{tp.pendingCount}</div>
						</div>
					</div>
					<ul className="tally-list">
						{tp.itemStatuses.map((row) => (
							<li key={row.code} className={statusClass(row.status)}>
								<span className="mono">
									{row.code}
									{row.hasHits ? '' : ' · no hits'}
								</span>
								<span>{statusLabel(row.status)}</span>
								<span className="muted" style={{ fontFamily: 'inherit' }}>
									{row.name}
								</span>
							</li>
						))}
						{tp.itemStatuses.length === 0 && (
							<li className="muted">No legend items classified in this tier.</li>
						)}
					</ul>
				</div>
			))}

			{focus && (
				<p className="muted mono">
					Focus Tier {tierToTest} · updated {findings?.meta?.updatedAt || '—'} · run{' '}
					{findings?.meta?.runId || '—'}
				</p>
			)}

			<details className="panel-section">
				<summary className="muted">Job log</summary>
				{job ? (
					<>
						<p className="muted">
							{job.kind} · <strong>{job.status}</strong>
							{job.error ? ` · ${job.error}` : ''}
						</p>
						<pre className="job-log">{(job.logTail || job.log || []).join('\n')}</pre>
					</>
				) : (
					<p className="muted">Idle — run match from Review to see progress here.</p>
				)}
			</details>
		</>
	);
}
