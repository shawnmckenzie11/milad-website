type Props = {
	cutawayRel: string;
	legendRel: string;
	usingDefaults: boolean;
	busy: boolean;
	onUpload: (cutaway: File | null, legend: File | null) => void;
	onResetDefaults: () => void;
	onExtract: () => void;
	onMatch: () => void;
	onRefreshFindings: () => void;
};

/**
 * Session inputs: default/upload assets and pipeline action buttons.
 */
export function InputsPanel({
	cutawayRel,
	legendRel,
	usingDefaults,
	busy,
	onUpload,
	onResetDefaults,
	onExtract,
	onMatch,
	onRefreshFindings,
}: Props) {
	return (
		<div className="panel-section">
			<h2>Inputs</h2>
			<p className="muted">
				{usingDefaults ? 'Using checked-in defaults' : 'Using uploaded session assets'}
			</p>
			<p className="mono">
				cutaway: {cutawayRel}
				<br />
				legend: {legendRel}
			</p>
			<div className="row" style={{ marginTop: '0.5rem' }}>
				<label className="muted">
					Cutaway PNG{' '}
					<input
						type="file"
						accept="image/png,image/jpeg"
						disabled={busy}
						onChange={(e) => onUpload(e.target.files?.[0] ?? null, null)}
					/>
				</label>
				<label className="muted">
					Legend PNG{' '}
					<input
						type="file"
						accept="image/png,image/jpeg"
						disabled={busy}
						onChange={(e) => onUpload(null, e.target.files?.[0] ?? null)}
					/>
				</label>
			</div>
			<div className="row" style={{ marginTop: '0.55rem' }}>
				<button type="button" disabled={busy} onClick={onResetDefaults}>
					Reset defaults
				</button>
				<button type="button" disabled={busy} onClick={onExtract}>
					Extract legend
				</button>
				<button type="button" className="primary" disabled={busy} onClick={onMatch}>
					Run match
				</button>
				<button type="button" disabled={busy} onClick={onRefreshFindings}>
					Refresh findings
				</button>
			</div>
		</div>
	);
}
