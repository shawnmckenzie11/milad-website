import { useEffect, useState } from 'react';
import type { Annotation, AnnotationLabel, EditMode, LegendItemRow, LocationTallyKind } from '../types';
import type { SelectedFinding } from './CutawayViewer';
import { isConfirmedLocked } from '../lib/tierProgress';

type Props = {
	finding: SelectedFinding | null;
	annotation?: Annotation;
	items: LegendItemRow[];
	/** Current observability tier (for copy). */
	tierToTest: number;
	editMode: EditMode;
	onEditMode: (mode: EditMode) => void;
	onAnnotate: (payload: {
		label: AnnotationLabel;
		reassignedCode?: string | null;
		note?: string;
		locationStatus?: LocationTallyKind | null;
	}) => void;
	onClearSelection: () => void;
};

/**
 * Right-rail review body for Select Match / Add Freehand (footer actions live in App).
 */
export function FindingDetail({
	finding,
	annotation,
	items,
	tierToTest,
	editMode,
	onEditMode,
	onAnnotate,
	onClearSelection,
}: Props) {
	const [note, setNote] = useState('');
	const [reassign, setReassign] = useState('');
	const [locationStatus, setLocationStatus] = useState<LocationTallyKind | ''>('');

	useEffect(() => {
		setNote(annotation?.note || '');
		setReassign(annotation?.reassignedCode || '');
		setLocationStatus(annotation?.locationStatus || '');
	}, [
		finding?.code,
		finding?.index,
		annotation?.note,
		annotation?.reassignedCode,
		annotation?.locationStatus,
	]);

	const freehandActive = editMode === 'freehand-classify';

	return (
		<div className="panel-section detail finding-detail">
			<div className="review-mode-toggle" role="group" aria-label="Review mode">
				<button
					type="button"
					className={!freehandActive ? 'primary' : undefined}
					aria-pressed={!freehandActive}
					onClick={() => onEditMode('select')}
				>
					1. Select Match
				</button>
				<button
					type="button"
					className={freehandActive ? 'primary' : undefined}
					aria-pressed={freehandActive}
					onClick={() => onEditMode(freehandActive ? 'select' : 'freehand-classify')}
				>
					2. Add Freehand
				</button>
			</div>

			{freehandActive ? (
				<div className="action-block">
					<div className="label">Add Freehand</div>
					<p className="muted" style={{ marginTop: 0 }}>
						Draw a closed loop on the cutaway around any feature — including novel or missed
						structures. The current zoom and pan are kept; points are recorded in native
						1024×953 art space. Tier difficulty comes from the legend item’s classification.
					</p>
					<p className="muted mono" style={{ marginTop: 6 }}>
						Draw to outline · Shift/Alt/middle-drag to pan while zoomed · release to classify
					</p>
					<button type="button" onClick={() => onEditMode('select')}>
						Cancel freehand
					</button>
				</div>
			) : !finding ? (
				<div className="action-block">
					<div className="label">Select Match</div>
					<p className="muted" style={{ margin: 0 }}>
						Click a yellow outline on the cutaway. Hits within ~40px of the click are selected.
						Use the left panel to isolate pathways or legend items for Tier {tierToTest}.
					</p>
					<p className="muted" style={{ marginBottom: 0 }}>
						Confirmed matches stay locked — overview only; review actions are disabled.
					</p>
					<p className="muted mono" style={{ marginBottom: 0 }}>
						Zoom stays when you switch to Add Freehand — draw at the current magnification;
						strokes are stored in native cutaway coordinates.
					</p>
				</div>
			) : (
				<>
					<div className="row" style={{ justifyContent: 'space-between' }}>
						<h3 style={{ margin: 0 }}>Selected match</h3>
						<button type="button" onClick={onClearSelection}>
							Clear
						</button>
					</div>
					{isConfirmedLocked(annotation) && (
						<p className="locked-banner" role="status">
							Confirmed · locked (uneditable). Overview only.
						</p>
					)}
					{annotation?.label === 'reassigned' && (
						<p className="reassign-banner" role="status">
							Reclassified as {annotation.reassignedCode || '—'}.
						</p>
					)}
					<MatchOverview
						finding={finding}
						item={items.find((i) => i.code === finding.code)}
						annotation={annotation}
					/>
					<MatchActions
						locked={isConfirmedLocked(annotation)}
						code={finding.code}
						items={items}
						note={note}
						reassign={reassign}
						locationStatus={locationStatus}
						onNote={setNote}
						onReassign={setReassign}
						onLocationStatus={setLocationStatus}
						onAnnotate={onAnnotate}
					/>
				</>
			)}
		</div>
	);
}

type OverviewProps = {
	finding: SelectedFinding;
	item: LegendItemRow | undefined;
	annotation?: Annotation;
};

/**
 * Read-only fields for the selected hit.
 */
function MatchOverview({ finding, item, annotation }: OverviewProps) {
	const { code, name, tier, slug, instance } = finding;
	return (
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
			<dd>
				<span className={`status-pill status-pill--${annotation?.label || 'unreviewed'}`}>
					{annotation?.label ?? 'unreviewed'}
				</span>
			</dd>
			<dt>location tally</dt>
			<dd>
				{annotation?.locationStatus ??
					(isConfirmedLocked(annotation) ? 'correct-location' : '—')}
			</dd>
		</dl>
	);
}

type ActionsProps = {
	locked: boolean;
	code: string;
	items: LegendItemRow[];
	note: string;
	reassign: string;
	locationStatus: LocationTallyKind | '';
	onNote: (v: string) => void;
	onReassign: (v: string) => void;
	onLocationStatus: (v: LocationTallyKind | '') => void;
	onAnnotate: (payload: {
		label: AnnotationLabel;
		reassignedCode?: string | null;
		note?: string;
		locationStatus?: LocationTallyKind | null;
	}) => void;
};

/**
 * Confirm / FP / reclassify controls for an unlocked selected match.
 */
function MatchActions({
	locked,
	code,
	items,
	note,
	reassign,
	locationStatus,
	onNote,
	onReassign,
	onLocationStatus,
	onAnnotate,
}: ActionsProps) {
	return (
		<div className={`action-block${locked ? ' locked' : ''}`}>
			<div className="label">Match review</div>
			<div className="row">
				<button
					type="button"
					className="primary"
					disabled={locked}
					onClick={() =>
						onAnnotate({
							label: 'confirmed',
							note,
							locationStatus: locationStatus || 'correct-location',
						})
					}
				>
					Confirm
				</button>
				<button
					type="button"
					disabled={locked}
					onClick={() =>
						onAnnotate({
							label: 'false-positive',
							note,
							locationStatus: locationStatus || null,
						})
					}
					title="Archive as false positive and remove from active hits / tables"
				>
					False positive
				</button>
			</div>
			<label className="muted" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
				Location tally
				<select
					value={locationStatus}
					disabled={locked}
					onChange={(e) => onLocationStatus(e.target.value as LocationTallyKind | '')}
				>
					<option value="">— infer from label / notes —</option>
					<option value="correct-location">Found in correct location</option>
					<option value="wrong-location">Found but incorrect location</option>
					<option value="pending-miss">Still pending (miss / one more)</option>
				</select>
			</label>
			<label className="muted" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
				Reclassify as
				<select
					value={reassign}
					disabled={locked}
					onChange={(e) => onReassign(e.target.value)}
				>
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
				disabled={locked || !reassign}
				style={{ marginTop: 6 }}
				onClick={() =>
					onAnnotate({
						label: 'reassigned',
						reassignedCode: reassign,
						note,
						locationStatus: locationStatus || null,
					})
				}
			>
				Apply reclassification
			</button>
			<label className="muted" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
				Note
				<textarea
					rows={2}
					value={note}
					disabled={locked}
					onChange={(e) => onNote(e.target.value)}
					placeholder='e.g. "one more B1 in this pathway" / "location is not correct"'
				/>
			</label>
		</div>
	);
}
