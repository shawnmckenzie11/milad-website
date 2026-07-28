import type { ReactNode } from 'react';
import type { FindingsDb, JobState } from '../types';
import { ProgressPanel } from './ProgressPanel';

type Props = {
	active: 'match' | 'pipeline';
	onChange: (tab: 'match' | 'pipeline') => void;
	matchPanel: ReactNode;
	findings: FindingsDb | null;
	job: JobState | null;
};

/**
 * Right-rail tabs: match actions (default) vs deferred pipeline diagnostics.
 */
export function SideTabs({ active, onChange, matchPanel, findings, job }: Props) {
	return (
		<div className="side-tabs">
			<div className="tab-bar" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={active === 'match'}
					className={active === 'match' ? 'tab active' : 'tab'}
					onClick={() => onChange('match')}
				>
					Match
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={active === 'pipeline'}
					className={active === 'pipeline' ? 'tab active' : 'tab'}
					onClick={() => onChange('pipeline')}
				>
					Pipeline
				</button>
			</div>
			<div className="tab-body">
				{active === 'match' ? matchPanel : <ProgressPanel findings={findings} job={job} />}
			</div>
		</div>
	);
}
