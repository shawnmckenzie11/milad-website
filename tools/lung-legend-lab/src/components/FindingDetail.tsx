import { useEffect, useState } from 'react';
import type { Annotation, AnnotationLabel, LegendItemRow } from '../types';
import type { SelectedFinding } from './CutawayViewer';

type Props = {
	finding: SelectedFinding | null;
	annotation?: Annotation;
	items: LegendItemRow[];
	editMode: 'select' | 'relocate' | 'resize' | 'trace';
	onEditMode: (mode: 'select' | 'relocate' | 'resize' | 'trace') => void;
	onAnnotate: (payload: {
		label: AnnotationLabel;
		reassignedCode?: string | null;
		note?: string;
	}) => void;
	onClearSelection: () => void;
};

/**
 * Right-rail overview + actions for the currently selected labeled match.
 */
export function FindingDetail({
	finding,
	annotation,
	items,
	editMode,
	onEditMode,
	onAnnotate,
	onClearSelection,
}: Props) {
	const [note, setNote] = useState('');
	const [reassign, setReassign] = useState('');

	useEffect(() => {
		setNote(annotation?.note || '');
		setReassign(annotation?.reassignedCode || '');
	}, [finding?.code, finding?.index, annotation?.note, annotation?.reassignedCode]);

	if (!finding) {
		return (
			<div className="panel-section">
				<h2>Selected match</h2>
				<p className="muted">
					Click a yellow outline / label on the cutaway. Hits within ~40px of the click are
					selected. Use layer chips to isolate one code.
				</p>
				<p className="muted">
					Tier-2 tools (adjacent-neighbour similarity): relocate, resize, or freehand-trace a
					better region after selecting a match — or start a trace with no selection to propose a
					missed instance.
				</p>
			</div>
		);
	}

	const { code, name, tier, slug, instance } = finding;
	const item = items.find((i) => i.code === code);
	const isTier2 = tier === 2;

	return (
		<div className="panel-section detail">
			<div className="row" style={{ justifyContent: 'space-between' }}>
				<h2 style={{ margin: 0 }}>Selected match</h2>
				<button type="button" onClick={onClearSelection}>
					Clear
				</button>
			</div>
			<dl>
				<dt>code</dt>
				<dd>{code}</dd>
				<dt>name</dt>
				<dd style={{ fontFamily: 'inherit' }}>{name}</dd>
				<dt>tier / sub</dt>
				<dd>
					{tier ?? '—'} / {item?.subTier ?? '—'}
				</dd>
				<dt>icon</dt>
				<dd>{item?.iconInterpretation ?? '—'}</dd>
				<dt>slug</dt>
				<dd>{slug ?? '—'}</dd>
				<dt>score</dt>
				<dd>{instance.score != null ? instance.score.toFixed(4) : '—'}</dd>
				<dt>position</dt>
				<dd>
					({instance.cx}, {instance.cy})
				</dd>
				<dt>box</dt>
				<dd>
					{instance.w ?? '—'}×{instance.h ?? '—'}
				</dd>
				<dt>status</dt>
				<dd>{annotation?.label ?? 'unreviewed'}</dd>
			</dl>

			<div className="action-block">
				<div className="label">Tier-1 review</div>
				<div className="row">
					<button
						type="button"
						className="primary"
						onClick={() => onAnnotate({ label: 'confirmed', note })}
					>
						Confirm
					</button>
					<button type="button" onClick={() => onAnnotate({ label: 'false-positive', note })}>
						False positive
					</button>
				</div>
				<label className="muted" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
					Reclassify as
					<select value={reassign} onChange={(e) => setReassign(e.target.value)}>
						<option value="">— keep {code} —</option>
						{items.map((c) => (
							<option key={c.code} value={c.code}>
								{c.code} · {c.name}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					disabled={!reassign}
					style={{ marginTop: 6 }}
					onClick={() =>
						onAnnotate({ label: 'reassigned', reassignedCode: reassign, note })
					}
				>
					Apply reclassification
				</button>
				<label className="muted" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
					Note
					<textarea
						rows={2}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Optional review note"
					/>
				</label>
			</div>

			<div className="action-block">
				<div className="label">
					Tier-2 geometry feedback{isTier2 ? '' : ' (available for any match)'}
				</div>
				<p className="muted" style={{ marginTop: 0 }}>
					Adjacent-neighbour similarity: nudge the box, resize it, or freehand-trace the true
					structure so the matcher can learn from your correction.
				</p>
				<div className="row">
					<button
						type="button"
						className={editMode === 'select' ? 'primary' : undefined}
						onClick={() => onEditMode('select')}
					>
						Select
					</button>
					<button
						type="button"
						className={editMode === 'relocate' ? 'primary' : undefined}
						onClick={() => onEditMode('relocate')}
					>
						Relocate
					</button>
					<button
						type="button"
						className={editMode === 'resize' ? 'primary' : undefined}
						onClick={() => onEditMode('resize')}
					>
						Resize
					</button>
					<button
						type="button"
						className={editMode === 'trace' ? 'primary' : undefined}
						onClick={() => onEditMode('trace')}
					>
						Trace
					</button>
				</div>
				<p className="muted mono" style={{ marginTop: 6 }}>
					mode={editMode}
					{editMode === 'relocate' && ' · drag the match center'}
					{editMode === 'resize' && ' · drag a corner handle'}
					{editMode === 'trace' && ' · draw on the cutaway, release to save'}
				</p>
			</div>
		</div>
	);
}
