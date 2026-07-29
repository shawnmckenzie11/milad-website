import { useEffect, useMemo, useState } from 'react';
import type { LegendItemRow, StyleGuideProfileBrief, TracePoint } from '../types';
import type { PathwayLayer } from '../lib/styleGuideLayers';
import { pathwaysForLegendItem } from '../lib/styleGuideLayers';

export type FreehandClassifyPayload = {
	code: string;
	name: string;
	tier: number;
	/** Optional; when empty, inferred from the legend item's subTier + iconInterpretation. */
	difficultyNote: string;
	note: string;
	points: TracePoint[];
	/** Image pathway layer ids (base / cannabis / …), same as legend assignedPathways. */
	assignedPathways: string[];
	/**
	 * True when the resolved code matches an existing legend row (use legend glyph in DB).
	 */
	existingLegendCode: boolean;
};

type Props = {
	/** Closed polyline drawn on the cutaway (first point equals last when closed). */
	points: TracePoint[];
	items: LegendItemRow[];
	/** Style-guide image pathway layers for assignment. */
	pathwayLayers: PathwayLayer[];
	/** Active style-guide brief (slug pathway fallback for existing codes). */
	styleGuideProfile?: StyleGuideProfileBrief | null;
	/** Suggested legend code (selected match / layer filter), if any. */
	defaultCode?: string;
	busy?: boolean;
	onCancel: () => void;
	onSubmit: (payload: FreehandClassifyPayload) => void;
};

/**
 * Build a short tier rationale from an existing legend row's classification fields.
 * Freehand difficulty is obvious from subTier + iconInterpretation — no why-prompt required.
 * @param item - Legend row when classifying an existing code
 * @param tier - Fallback tier when the row has none
 */
export function inferDifficultyNote(
	item: LegendItemRow | undefined,
	tier: number,
): string {
	if (!item) return `Tier ${tier} · novel / unlisted structure`;
	const bits: string[] = [`Tier ${item.tier ?? tier}`];
	if (item.subTier) bits.push(`subTier=${item.subTier}`);
	if (item.iconInterpretation) bits.push(`icon=${item.iconInterpretation}`);
	return bits.join(' · ');
}

/**
 * Modal form to manually classify a freehand closed-loop region on the cutaway.
 * Tier rationale is inferred from the legend item; pathway defaults sync from the
 * chosen existing code (style guide / classification / supports) with override.
 */
export function FreehandClassifyForm({
	points,
	items,
	pathwayLayers,
	styleGuideProfile = null,
	defaultCode = '',
	busy = false,
	onCancel,
	onSubmit,
}: Props) {
	const [codeMode, setCodeMode] = useState<'existing' | 'new'>(
		defaultCode && items.some((i) => i.code === defaultCode) ? 'existing' : 'new',
	);
	const [code, setCode] = useState(defaultCode || '');
	const [newCode, setNewCode] = useState('');
	const [name, setName] = useState('');
	const [tier, setTier] = useState(2);
	const [note, setNote] = useState('');
	const [assignedPathways, setAssignedPathways] = useState<string[]>(() =>
		pathwaysForLegendItem(
			items.find((i) => i.code === defaultCode),
			pathwayLayers,
			styleGuideProfile,
		),
	);

	useEffect(() => {
		if (!defaultCode) return;
		const row = items.find((i) => i.code === defaultCode);
		if (row) {
			setCodeMode('existing');
			setCode(row.code);
			setName(row.name || '');
			setTier(row.tier ?? 2);
			setAssignedPathways(pathwaysForLegendItem(row, pathwayLayers, styleGuideProfile));
		}
	}, [defaultCode, items, pathwayLayers, styleGuideProfile]);

	const selectedItem = useMemo(() => {
		if (codeMode !== 'existing') return undefined;
		return items.find((i) => i.code === code);
	}, [codeMode, code, items]);

	const inferredRationale = useMemo(
		() => inferDifficultyNote(selectedItem, tier),
		[selectedItem, tier],
	);

	/**
	 * Resolve the effective legend code from existing-select vs new-label mode.
	 */
	function resolvedCode(): string {
		if (codeMode === 'existing') return code.trim();
		return newCode.trim();
	}

	/**
	 * Apply name / tier / pathway defaults from a legend row (code pick or mode switch).
	 * @param row - Existing legend item
	 */
	function syncFromLegendItem(row: LegendItemRow) {
		setName(row.name || '');
		if (row.tier != null) setTier(row.tier);
		setAssignedPathways(pathwaysForLegendItem(row, pathwayLayers, styleGuideProfile));
	}

	/**
	 * Toggle an image pathway layer in the freehand assignment multi-select.
	 * @param id - Pathway layer id
	 */
	function togglePathway(id: string) {
		setAssignedPathways((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	}

	/**
	 * Validate and submit the freehand classification payload.
	 * Difficulty note is optional; empty values are filled from classification fields.
	 * Existing codes always persist that code’s resolved pathways (after any override).
	 */
	function handleSubmit() {
		const resolved = resolvedCode();
		if (!resolved) return;
		const item =
			codeMode === 'existing' ? items.find((i) => i.code === resolved) : undefined;
		const pathways =
			assignedPathways.length > 0
				? [...assignedPathways]
				: pathwaysForLegendItem(item, pathwayLayers, styleGuideProfile);
		if (pathways.length === 0) return;
		onSubmit({
			code: resolved,
			name: name.trim() || resolved,
			tier,
			difficultyNote: inferDifficultyNote(item, tier),
			note: note.trim(),
			points,
			assignedPathways: pathways,
			existingLegendCode: Boolean(item),
		});
	}

	const canSubmit =
		Boolean(resolvedCode()) &&
		(assignedPathways.length > 0 ||
			(codeMode === 'existing' &&
				pathwaysForLegendItem(selectedItem, pathwayLayers, styleGuideProfile).length >
					0)) &&
		!busy;

	return (
		<div className="modal-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="modal-card freehand-classify-modal"
				role="dialog"
				aria-labelledby="freehand-classify-title"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 id="freehand-classify-title">Freehand Classification</h2>
				<p className="muted">
					Closed loop with {points.length} points. Tier difficulty is taken from the legend
					item’s sub-tier and icon interpretation when classifying an existing code.
				</p>

				<label className="field">
					Legend code
					<div className="row" style={{ marginTop: 4 }}>
						<button
							type="button"
							className={codeMode === 'existing' ? 'primary' : undefined}
							disabled={busy}
							onClick={() => {
								setCodeMode('existing');
								const row = items.find((i) => i.code === code);
								if (row) syncFromLegendItem(row);
							}}
						>
							Existing
						</button>
						<button
							type="button"
							className={codeMode === 'new' ? 'primary' : undefined}
							disabled={busy}
							onClick={() => setCodeMode('new')}
						>
							New label
						</button>
					</div>
				</label>

				{codeMode === 'existing' ? (
					<label className="field">
						Code
						<select
							value={code}
							disabled={busy}
							onChange={(e) => {
								const next = e.target.value;
								setCode(next);
								const row = items.find((i) => i.code === next);
								if (row) syncFromLegendItem(row);
							}}
						>
							<option value="">— pick code —</option>
							{items.map((it) => (
								<option key={it.code} value={it.code}>
									{it.code} · {it.name}
								</option>
							))}
						</select>
					</label>
				) : (
					<label className="field">
						New code / label id
						<input
							type="text"
							value={newCode}
							disabled={busy}
							placeholder="e.g. X1 or novel-alveolar-edge"
							onChange={(e) => setNewCode(e.target.value)}
						/>
					</label>
				)}

				<label className="field">
					Name
					<input
						type="text"
						value={name}
						disabled={busy}
						placeholder="e.g. Alveolar Fields"
						onChange={(e) => setName(e.target.value)}
					/>
				</label>

				<label className="field">
					Tier
					<select
						value={tier}
						disabled={busy || (codeMode === 'existing' && selectedItem?.tier != null)}
						onChange={(e) => setTier(Number(e.target.value))}
					>
						<option value={1}>Tier 1 · exact replicas</option>
						<option value={2}>Tier 2 · partial / neighbour</option>
						<option value={3}>Tier 3 · scale-divergent</option>
						<option value={0}>Tier 0 · skip / not searchable</option>
					</select>
				</label>

				<fieldset className="field freehand-pathway-fieldset">
					<legend>Image pathway layer</legend>
					<p className="muted" style={{ margin: '0 0 0.35rem', fontSize: '0.78rem' }}>
						{codeMode === 'existing'
							? 'Defaults from the selected legend code (style guide / classification); override if needed.'
							: 'Assign this outline to one or more exposure layers (same as legend assignedPathways).'}
					</p>
					<div
						className="freehand-pathway-checks"
						role="group"
						aria-label="Image pathway layers"
					>
						{pathwayLayers.map((l) => (
							<label key={l.id} className="freehand-pathway-check">
								<input
									type="checkbox"
									checked={assignedPathways.includes(l.id)}
									disabled={busy}
									onChange={() => togglePathway(l.id)}
								/>
								<span title={l.label}>{l.label}</span>
							</label>
						))}
						{pathwayLayers.length === 0 && (
							<p className="muted">No pathways in style guide.</p>
						)}
					</div>
				</fieldset>

				{codeMode === 'existing' && selectedItem && (
					<p className="muted freehand-inferred-rationale" role="status">
						From classification: {inferredRationale}
					</p>
				)}

				<label className="field">
					Optional note
					<textarea
						rows={2}
						value={note}
						disabled={busy}
						placeholder="Optional context for the matcher or review"
						onChange={(e) => setNote(e.target.value)}
					/>
				</label>

				<div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
					<button type="button" disabled={busy} onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="primary" disabled={!canSubmit} onClick={handleSubmit}>
						Save classification
					</button>
				</div>
			</div>
		</div>
	);
}
