import { useState } from 'react';
import type { RlFeedbackSummary } from '../types';

type Props = {
	open: boolean;
	summary: RlFeedbackSummary | null;
	busy: boolean;
	forceFull: boolean;
	onForceFullChange: (value: boolean) => void;
	onClose: () => void;
	/** Persist prompt + advance delta cursor, then copy markdown. */
	onCopyAndCommit: () => Promise<void>;
};

/**
 * Modal for Generate Feedback Prompt: delta RL markdown for Cursor, no in-app rematch.
 */
export function FeedbackPromptModal({
	open,
	summary,
	busy,
	forceFull,
	onForceFullChange,
	onClose,
	onCopyAndCommit,
}: Props) {
	const [copied, setCopied] = useState(false);

	if (!open || !summary) return null;

	const { counts, tierToTest, promptMarkdown, isDelta, since, mode, modeLabel, missAttribution } =
		summary;
	const scopeLabel = tierToTest === 'all' ? 'all searchable tiers (1–3)' : `Tier ${tierToTest}`;

	/**
	 * Commit the prompt (save + cursor) and copy markdown for Cursor chat.
	 */
	async function handleCopy() {
		try {
			await onCopyAndCommit();
			await navigator.clipboard.writeText(promptMarkdown);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2500);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div
			className="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="rl-prompt-title"
		>
			<div className="modal-card">
				<h2 id="rl-prompt-title">Generate Feedback Prompt</h2>
				<p className="muted">
					Builds a lean Cursor paste for {scopeLabel}: MODE header, REF paths to rules/agents,
					and this review delta only (process boilerplate stays in project files). Rematch
					runs in chat — this dialog does not invoke OpenCV.
					{isDelta
						? ' Showing only new review since the last export.'
						: ' Showing full history for the export scope.'}
				</p>
				<p className="rl-mode-banner" role="status">
					<strong>MODE:</strong> <code>{mode}</code>
					<span className="muted"> — {modeLabel}</span>
					{missAttribution !== 'none' && (
						<>
							<br />
							<strong>Miss path:</strong> <code>{missAttribution}</code>
						</>
					)}
				</p>
				<label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={forceFull}
						disabled={busy}
						onChange={(e) => onForceFullChange(e.target.checked)}
					/>
					Include full history (not just this iteration)
				</label>
				<div className="stats-grid">
					<div className="stat">
						<div className="label">New confirms</div>
						<div className="value">{counts.confirms}</div>
					</div>
					<div className="stat">
						<div className="label">New FPs</div>
						<div className="value">{counts.falsePositives}</div>
					</div>
					<div className="stat">
						<div className="label">Freehand</div>
						<div className="value">{counts.freehand}</div>
					</div>
					<div className="stat">
						<div className="label">Other / notes</div>
						<div className="value">
							{counts.geometry - counts.freehand}/{counts.notes}
						</div>
					</div>
				</div>
				{since && isDelta && (
					<p className="muted mono" style={{ marginTop: 0 }}>
						delta since {since}
					</p>
				)}
				<details open>
					<summary>
						Generated prompt ({tierToTest === 'all' ? 'all tiers' : `Tier ${tierToTest}`})
					</summary>
					<pre className="rl-prompt-preview">{promptMarkdown}</pre>
				</details>
				<div
					className="row"
					style={{ justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}
				>
					<button type="button" className="primary" disabled={busy} onClick={() => void handleCopy()}>
						{copied ? 'Copied — cursor advanced' : 'Copy prompt for Cursor'}
					</button>
					<button type="button" disabled={busy} onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
