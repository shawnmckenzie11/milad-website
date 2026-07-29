import { useMemo, useState, type ReactNode } from 'react';
import type {
	Annotation,
	DatabaseRowStatus,
	FindingsDb,
	JobState,
	LegendItemRow,
	StyleGuideProfileBrief,
	TierProgressSnapshot,
	TracePoint,
	TrainingFeedback,
} from '../types';
import { assetUrl } from '../api';
import {
	collectPurgedHits,
	collectSuppressedCodes,
	isCodeSuppressed,
	isHitPurged,
} from '../lib/purgedHits';
import {
	classifyMatchVsFreehand,
	matchContestsFreehand,
	summarizeFreehandPoints,
} from '../lib/freehandMatchReconcile';
import { OUTLINE_COLOR_HEX, OUTLINE_FILL_RGBA } from '../lib/outlineStyle';
import {
	effectivePathwayIds,
	pathwaysForLegendItem,
	type PathwayLayer,
} from '../lib/styleGuideLayers';
import { ProgressPanel } from './ProgressPanel';
import type { SelectedFinding } from './CutawayViewer';

export type DatabaseMatchRow = {
	id: string;
	kind: 'match' | 'freehand';
	code: string;
	name: string;
	tier: number | null;
	pathway: string;
	status: DatabaseRowStatus;
	score: number | null;
	cx: number | null;
	cy: number | null;
	index: number;
	pointCount?: number;
	/** Freehand outline vertices for row thumbnail (freehand rows only). */
	points?: TracePoint[] | null;
	/** Persisted legend-style icon id for `/api/assets/freehand-icon/{id}`. */
	iconId?: string | null;
	/**
	 * When true, Database View shows the standard legend glyph for this freehand
	 * (existing code). Novel freehands keep the crop / outline thumbnail.
	 */
	useLegendGlyph?: boolean;
	difficultyNote?: string | null;
	/** Finding to select when reviewing (match rows only). */
	finding: SelectedFinding | null;
};

type SortKey = 'code' | 'name' | 'status' | 'score' | 'pathway';
export type DatabaseGroupBy = 'type' | 'pathway' | 'none';

type RowSummary = {
	total: number;
	confirmed: number;
	unreviewed: number;
	falsePositive: number;
	reassigned: number;
	pending: number;
	freehand: number;
	withScore: number;
	meanScore: number | null;
	hitCount: number;
};

export type DatabaseViewModel = {
	statusFilter: string;
	setStatusFilter: (v: string) => void;
	tierFilter: string;
	setTierFilter: (v: string) => void;
	pathwayFilter: string;
	setPathwayFilter: (v: string) => void;
	labelFilter: string;
	setLabelFilter: (v: string) => void;
	groupBy: DatabaseGroupBy;
	setGroupBy: (v: DatabaseGroupBy) => void;
	sortKey: SortKey;
	sortDir: 'asc' | 'desc';
	toggleSort: (key: SortKey) => void;
	sortMark: (key: SortKey) => string;
	allRows: DatabaseMatchRow[];
	filtered: DatabaseMatchRow[];
	rowsByTier: Array<{
		tier: number;
		rows: DatabaseMatchRow[];
		progress: TierProgressSnapshot | undefined;
	}>;
};

type Props = {
	model: DatabaseViewModel;
	findings: FindingsDb | null;
	job: JobState | null;
	tierProgress: TierProgressSnapshot[];
	tierToTest: number;
	beforeProgress: TierProgressSnapshot | null;
	afterProgress: TierProgressSnapshot | null;
	/** Currently selected database row id (middle → right panel). */
	selectedRowId?: string | null;
	/** Cache-bust for legend glyph assets in table rows. */
	bust?: number;
	busy?: boolean;
	/**
	 * Select a row for the right-hand review panel (stay in Database View).
	 * @param row - Clicked row
	 */
	onSelectRow: (row: DatabaseMatchRow) => void;
	/**
	 * Optional jump to Image View with the match selected.
	 * @param finding - Match to select, or null for freehand-only rows
	 * @param code - Legend code to focus
	 */
	onOpenInReview?: (finding: SelectedFinding | null, code: string) => void;
	/**
	 * Permanently delete a database row (match hit or freehand) from all views.
	 * @param row - Row to delete
	 */
	onDeleteRow?: (row: DatabaseMatchRow) => void;
};

const TIER_ORDER = [1, 2, 3, 0] as const;

/**
 * Resolve display status for a match annotation (or unreviewed).
 * False positives are purged from active tables — they never reach this helper.
 * @param ann - Annotation for the hit, if any
 */
function matchStatus(ann: Annotation | undefined): DatabaseRowStatus {
	if (!ann) return 'unreviewed';
	if (ann.label === 'confirmed') return 'confirmed';
	if (ann.label === 'reassigned') return 'reassigned';
	return 'unreviewed';
}

/**
 * Aggregate status / score stats for a set of database rows.
 * @param rows - Rows in a tier or subgroup
 */
export function summarizeRows(rows: DatabaseMatchRow[]): RowSummary {
	const withScores = rows.filter((r) => r.score != null);
	const meanScore =
		withScores.length > 0
			? withScores.reduce((s, r) => s + (r.score || 0), 0) / withScores.length
			: null;
	return {
		total: rows.length,
		confirmed: rows.filter((r) => r.status === 'confirmed').length,
		unreviewed: rows.filter((r) => r.status === 'unreviewed').length,
		falsePositive: rows.filter((r) => r.status === 'false-positive').length,
		reassigned: rows.filter((r) => r.status === 'reassigned').length,
		pending: rows.filter((r) => r.status === 'pending').length,
		freehand: rows.filter((r) => r.status === 'freehand').length,
		withScore: withScores.length,
		meanScore,
		hitCount: rows.filter((r) => r.kind === 'match' && r.index >= 0).length,
	};
}

/**
 * Resolve display pathway text for a freehand or legend row.
 * @param assigned - Stored freehand / legend pathways
 * @param legend - Matching legend item when present
 * @param profile - Style-guide brief
 * @param pathwayLayers - Catalog for labels
 */
function pathwayDisplayFor(
	assigned: string[] | string | null | undefined,
	legend: LegendItemRow | undefined,
	profile: StyleGuideProfileBrief | null | undefined,
	pathwayLayers: PathwayLayer[],
): string {
	const ids =
		(Array.isArray(assigned) && assigned.length > 0) ||
		(typeof assigned === 'string' && assigned.trim())
			? effectivePathwayIds(assigned, legend?.supports, {
					code: legend?.code,
					profile,
				})
			: pathwaysForLegendItem(legend, pathwayLayers, profile);
	if (ids.length === 0) return legend?.supports || '';
	return ids
		.map((id) => pathwayLayers.find((l) => l.id === id)?.label || id)
		.join(', ');
}

/**
 * Build a flat, filterable table of match instances + freehand classifications.
 * Hits archived as false positives are omitted (they live only in the RL feedback log).
 *
 * @param items - Legend rows with instances
 * @param annotations - Active hit annotations (confirmed / reassigned)
 * @param feedback - Training feedback (includes freehand-classify + FP archive)
 * @param opts - Optional style-guide context for pathway labels / glyph preference
 */
export function buildDatabaseRows(
	items: LegendItemRow[],
	annotations: Annotation[],
	feedback: TrainingFeedback[],
	opts?: {
		styleGuideProfile?: StyleGuideProfileBrief | null;
		pathwayLayers?: PathwayLayer[];
	},
): DatabaseMatchRow[] {
	const rows: DatabaseMatchRow[] = [];
	const purged = collectPurgedHits(feedback, annotations);
	const suppressedCodes = collectSuppressedCodes(feedback);
	const profile = opts?.styleGuideProfile ?? null;
	const pathwayLayers = opts?.pathwayLayers ?? [];

	/** Freehand geometry by legend code (for match ↔ freehand reconcile). */
	const freehandByCode = new Map<
		string,
		{ cx: number; cy: number; w: number; h: number; id: string }
	>();
	for (const fb of feedback) {
		if (fb.kind !== 'freehand-classify') continue;
		const geo = summarizeFreehandPoints(fb.points);
		if (!geo || !fb.code) continue;
		freehandByCode.set(fb.code, { ...geo, id: fb.id });
	}

	/** Codes whose freehand is superseded by a compatible algorithm hit. */
	const supersededFreehandCodes = new Set<string>();

	for (const it of items) {
		const instances = (it.instances || []).filter((instance) => {
			const cx = instance.cx ?? 0;
			const cy = instance.cy ?? 0;
			if (isHitPurged(it.code, cx, cy, purged)) return false;
			const fh = freehandByCode.get(it.code);
			if (!fh) return true;
			const w = instance.w ?? null;
			const h = instance.h ?? null;
			// A different instance of the same code (A1 mid-stem vs lumen band) is
			// not judged against this outline.
			if (!matchContestsFreehand({ cx, cy, w, h }, fh)) return true;
			const verdict = classifyMatchVsFreehand({ cx, cy, w, h }, fh);
			if (verdict === 'compatible') {
				supersededFreehandCodes.add(it.code);
				return true;
			}
			// Incompatible with freehand GT — hide until purge/reconcile catches up.
			return false;
		});
		const pathway = pathwayDisplayFor(
			it.assignedPathways ?? it.assignedPathway,
			it,
			profile,
			pathwayLayers,
		);
		if (instances.length === 0) {
			if (isCodeSuppressed(it.code, suppressedCodes)) continue;
			// Freehand-only codes still show via freehand rows below (not a pending stub).
			if (freehandByCode.has(it.code) && !supersededFreehandCodes.has(it.code)) {
				continue;
			}
			const hadOnlyPurged =
				(it.instances || []).length > 0 &&
				(it.instances || []).every((instance) =>
					isHitPurged(it.code, instance.cx ?? 0, instance.cy ?? 0, purged),
				);
			rows.push({
				id: `item-${it.code}`,
				kind: 'match',
				code: it.code,
				name: it.name,
				tier: it.tier,
				pathway: pathway || it.supports || '',
				status: 'pending',
				score: hadOnlyPurged ? null : (it.bestScore ?? null),
				cx: null,
				cy: null,
				index: -1,
				finding: null,
			});
			continue;
		}
		instances.forEach((instance, index) => {
			const cx = instance.cx ?? 0;
			const cy = instance.cy ?? 0;
			const ann = annotations.find(
				(a) =>
					a.label !== 'false-positive' &&
					a.code === it.code &&
					Math.abs(a.cx - cx) < 1.5 &&
					Math.abs(a.cy - cy) < 1.5,
			);
			rows.push({
				id: `hit-${it.code}-${index}-${cx}-${cy}`,
				kind: 'match',
				code: it.code,
				name: it.name,
				tier: it.tier,
				pathway: pathway || it.supports || '',
				status: matchStatus(ann),
				score: instance.score ?? null,
				cx,
				cy,
				index,
				finding: {
					code: it.code,
					name: it.name,
					tier: it.tier,
					slug: it.slug,
					instance,
					index,
				},
			});
		});
	}

	for (const fb of feedback) {
		if (fb.kind !== 'freehand-classify') continue;
		if (supersededFreehandCodes.has(fb.code)) continue;
		const legend = items.find((i) => i.code === fb.code);
		const useLegendGlyph = Boolean(legend);
		const pts = fb.points || [];
		const cx =
			pts.length > 0 ? pts.reduce((s, p) => s + p.x, 0) / pts.length : null;
		const cy =
			pts.length > 0 ? pts.reduce((s, p) => s + p.y, 0) / pts.length : null;
		rows.push({
			id: fb.id,
			kind: 'freehand',
			code: fb.code,
			name: fb.name || legend?.name || fb.code,
			tier: fb.tier ?? legend?.tier ?? null,
			pathway: pathwayDisplayFor(
				fb.assignedPathways ?? fb.assignedPathway,
				legend,
				profile,
				pathwayLayers,
			),
			status: 'freehand',
			score: fb.score ?? 1,
			cx,
			cy,
			index: -1,
			pointCount: pts.length,
			points: pts,
			iconId: !useLegendGlyph && fb.iconRel ? fb.id : null,
			useLegendGlyph,
			difficultyNote: fb.difficultyNote ?? fb.note ?? null,
			finding: null,
		});
	}

	return rows;
}

/**
 * Sort database rows by the active column.
 * @param list - Rows to sort
 * @param sortKey - Column key
 * @param sortDir - Ascending or descending
 */
function sortRows(
	list: DatabaseMatchRow[],
	sortKey: SortKey,
	sortDir: 'asc' | 'desc',
): DatabaseMatchRow[] {
	return [...list].sort((a, b) => {
		let cmp = 0;
		if (sortKey === 'code') cmp = a.code.localeCompare(b.code);
		else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
		else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
		else if (sortKey === 'pathway') cmp = a.pathway.localeCompare(b.pathway);
		else if (sortKey === 'score') cmp = (a.score ?? -1) - (b.score ?? -1);
		return sortDir === 'asc' ? cmp : -cmp;
	});
}

/**
 * Group key for subgrouping within a tier table.
 * @param row - Database row
 * @param groupBy - Grouping mode
 */
function groupKeyFor(row: DatabaseMatchRow, groupBy: DatabaseGroupBy): string {
	if (groupBy === 'pathway') {
		return row.pathway.trim() || '(no pathway)';
	}
	if (groupBy === 'type') {
		return `${row.code} · ${row.name}`;
	}
	return row.id;
}

/**
 * Human label for a tier section header.
 * @param tier - Tier number
 */
function tierSectionTitle(tier: number): string {
	if (tier === 0) return 'Tier 0 · Not searchable';
	if (tier === 1) return 'Tier 1 · Exact replicas';
	if (tier === 2) return 'Tier 2 · Partial / neighbour similarity';
	if (tier === 3) return 'Tier 3 · Hard / scale-divergent';
	return `Tier ${tier}`;
}

/**
 * Compact summary chips for a tier or subgroup header.
 * @param summary - Aggregated row stats
 */
function SummaryChips({ summary }: { summary: RowSummary }): ReactNode {
	return (
		<span className="db-summary-chips">
			<span className="db-chip">{summary.total} rows</span>
			<span className="db-chip db-chip--ok">{summary.confirmed} confirmed</span>
			<span className="db-chip db-chip--warn">{summary.unreviewed} unreviewed</span>
			{summary.pending > 0 && (
				<span className="db-chip">{summary.pending} pending</span>
			)}
			{summary.freehand > 0 && (
				<span className="db-chip db-chip--freehand">{summary.freehand} freehand</span>
			)}
			{summary.meanScore != null && (
				<span className="db-chip mono">μ score {summary.meanScore.toFixed(3)}</span>
			)}
		</span>
	);
}

/**
 * Inline SVG thumbnail of a freehand outline for database table rows.
 * @param points - Outline vertices in cutaway coords
 */
function FreehandThumb({ points }: { points: TracePoint[] }): ReactNode {
	if (points.length < 2) {
		return <span className="db-row-icon db-row-icon--empty" aria-hidden />;
	}
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const pad = 6;
	const w = Math.max(1, maxX - minX);
	const h = Math.max(1, maxY - minY);
	const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
	return (
		<svg
			className="db-row-icon db-row-icon--freehand"
			viewBox={vb}
			width={28}
			height={28}
			aria-hidden
		>
			<polygon
				points={points.map((p) => `${p.x},${p.y}`).join(' ')}
				fill={OUTLINE_FILL_RGBA}
				stroke={OUTLINE_COLOR_HEX}
			/>
		</svg>
	);
}

/**
 * Legend glyph or freehand thumbnail for a database row.
 * Freehands assigned to an existing legend code use `/api/assets/glyph/{code}`.
 * Novel freehands use the crop icon or an inline SVG silhouette.
 * @param row - Table row
 * @param bust - Asset cache-bust
 */
function RowIcon({ row, bust = 0 }: { row: DatabaseMatchRow; bust?: number }): ReactNode {
	if (row.kind === 'freehand' && !row.useLegendGlyph) {
		if (row.iconId) {
			return (
				<img
					className="db-row-icon db-row-icon--freehand-glyph"
					src={assetUrl(`/api/assets/freehand-icon/${row.iconId}`, bust)}
					alt=""
					width={28}
					height={28}
					draggable={false}
				/>
			);
		}
		if (row.points && row.points.length >= 2) {
			return <FreehandThumb points={row.points} />;
		}
		return <span className="db-row-icon db-row-icon--empty" aria-hidden />;
	}
	return (
		<img
			className="db-row-icon db-row-icon--glyph"
			src={assetUrl(`/api/assets/glyph/${row.code}`, bust)}
			alt=""
			width={28}
			height={28}
			draggable={false}
		/>
	);
}

type TableProps = {
	rows: DatabaseMatchRow[];
	sortKey: SortKey;
	sortMark: (key: SortKey) => string;
	onToggleSort: (key: SortKey) => void;
	selectedRowId?: string | null;
	onSelectRow: (row: DatabaseMatchRow) => void;
	/** When set, show a Delete control on deletable rows. */
	onDeleteRow?: (row: DatabaseMatchRow) => void;
	bust?: number;
	busy?: boolean;
};

/**
 * Whether a database row can be permanently deleted.
 * Every real table row is deletable (match hit, pending placeholder, freehand,
 * confirmed / unreviewed). Maintainer purge — not review unlock.
 * @param row - Table row
 */
export function rowIsDeletable(row: DatabaseMatchRow): boolean {
	return Boolean(row?.code);
}

/**
 * Full match table body for one tier (or one subgroup).
 */
function MatchTable({
	rows,
	sortKey,
	sortMark,
	onToggleSort,
	selectedRowId,
	onSelectRow,
	onDeleteRow,
	bust = 0,
	busy = false,
}: TableProps) {
	return (
		<table className="database-table">
			<thead>
				<tr>
					<th className="db-col-icon" aria-label="Icon" />
					<th>
						<button type="button" className="linkish" onClick={() => onToggleSort('code')}>
							Code{sortMark('code')}
						</button>
					</th>
					<th>
						<button type="button" className="linkish" onClick={() => onToggleSort('name')}>
							Name{sortMark('name')}
						</button>
					</th>
					<th>
						<button type="button" className="linkish" onClick={() => onToggleSort('status')}>
							Status{sortMark('status')}
						</button>
					</th>
					<th>
						<button type="button" className="linkish" onClick={() => onToggleSort('pathway')}>
							Pathway{sortMark('pathway')}
						</button>
					</th>
					<th>
						<button type="button" className="linkish" onClick={() => onToggleSort('score')}>
							Score{sortMark('score')}
						</button>
					</th>
					<th>Position</th>
					<th>Kind</th>
					{onDeleteRow ? <th className="db-col-actions" aria-label="Actions" /> : null}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr
						key={row.id}
						className={`db-row db-row--${row.status} clickable${selectedRowId === row.id ? ' selected' : ''}`}
						onClick={() => onSelectRow(row)}
						title={
							row.difficultyNote ||
							(row.finding ? 'Show details in review panel' : 'Focus code in review panel')
						}
					>
						<td className="db-col-icon">
							<RowIcon row={row} bust={bust} />
						</td>
						<td className="mono">{row.code}</td>
						<td style={{ fontFamily: 'inherit' }}>{row.name}</td>
						<td>
							<span className={`status-pill status-pill--${row.status}`}>{row.status}</span>
						</td>
						<td style={{ fontFamily: 'inherit', fontSize: '0.82rem' }}>
							{row.pathway || '—'}
						</td>
						<td className="mono">
							{row.score != null
								? row.kind === 'freehand' && row.score >= 0.999
									? '100%'
									: row.score.toFixed(3)
								: '—'}
						</td>
						<td className="mono">
							{row.cx != null && row.cy != null
								? `(${Math.round(row.cx)}, ${Math.round(row.cy)})`
								: '—'}
						</td>
						<td className="muted">
							{row.kind === 'freehand'
								? `freehand · ${row.pointCount ?? 0} pts`
								: row.index >= 0
									? `hit #${row.index + 1}`
									: 'item'}
						</td>
						{onDeleteRow ? (
							<td className="db-col-actions">
								{rowIsDeletable(row) ? (
									<button
										type="button"
										className="db-row-delete analysis-delete-btn"
										disabled={busy}
										title="Delete from all views"
										onClick={(e) => {
											e.stopPropagation();
											onDeleteRow(row);
										}}
									>
										Delete
									</button>
								) : (
									<span className="muted">—</span>
								)}
							</td>
						) : null}
					</tr>
				))}
				{rows.length === 0 && (
					<tr>
						<td colSpan={onDeleteRow ? 9 : 8} className="muted">
							No rows in this group.
						</td>
					</tr>
				)}
			</tbody>
		</table>
	);
}

type TierSectionProps = {
	tier: number;
	rows: DatabaseMatchRow[];
	groupBy: DatabaseGroupBy;
	onGroupByChange: (v: DatabaseGroupBy) => void;
	defaultOpen: boolean;
	tierProgress?: TierProgressSnapshot;
	sortKey: SortKey;
	sortMark: (key: SortKey) => string;
	onToggleSort: (key: SortKey) => void;
	selectedRowId?: string | null;
	onSelectRow: (row: DatabaseMatchRow) => void;
	onDeleteRow?: (row: DatabaseMatchRow) => void;
	bust?: number;
	busy?: boolean;
};

/**
 * Expandable full table for one observability tier, with type/pathway grouping
 * and row stats nested inside the tier section.
 */
function TierTableSection({
	tier,
	rows,
	groupBy,
	onGroupByChange,
	defaultOpen,
	tierProgress,
	sortKey,
	sortMark,
	onToggleSort,
	selectedRowId,
	onSelectRow,
	onDeleteRow,
	bust = 0,
	busy = false,
}: TierSectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	const summary = useMemo(() => summarizeRows(rows), [rows]);
	const graduation = tierProgress?.graduation;

	const groups = useMemo(() => {
		if (groupBy === 'none') {
			return [{ key: 'all', label: 'All items', rows }];
		}
		const map = new Map<string, DatabaseMatchRow[]>();
		for (const row of rows) {
			const key = groupKeyFor(row, groupBy);
			const list = map.get(key) || [];
			list.push(row);
			map.set(key, list);
		}
		return [...map.entries()]
			.map(([key, groupRows]) => ({
				key,
				label: key,
				rows: groupRows,
				summary: summarizeRows(groupRows),
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
	}, [rows, groupBy]);

	return (
		<details
			className="db-tier-section"
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
		>
			<summary className="db-tier-summary">
				<div className="db-tier-summary__main">
					<strong>{tierSectionTitle(tier)}</strong>
					{graduation?.good && <span className="db-chip db-chip--good">good</span>}
					{tierProgress && (
						<span className="muted mono" style={{ fontSize: '0.75rem' }}>
							correctness {(tierProgress.correctnessPct * 100).toFixed(0)}% · FP{' '}
							{(tierProgress.fpRate * 100).toFixed(0)}%
						</span>
					)}
				</div>
				<SummaryChips summary={summary} />
			</summary>

			<div className="db-tier-body">
				<div className="db-tier-toolbar">
					<label className="db-tier-toolbar__field">
						Group within tier
						<select
							value={groupBy}
							onChange={(e) => onGroupByChange(e.target.value as DatabaseGroupBy)}
							onClick={(e) => e.stopPropagation()}
						>
							<option value="type">By type / label</option>
							<option value="pathway">By layer / pathway</option>
							<option value="none">Flat table</option>
						</select>
					</label>
				</div>

				{groupBy === 'none' ? (
					<div className="database-table-wrap">
						<MatchTable
							rows={rows}
							sortKey={sortKey}
							sortMark={sortMark}
							onToggleSort={onToggleSort}
							selectedRowId={selectedRowId}
							onSelectRow={onSelectRow}
							onDeleteRow={onDeleteRow}
							bust={bust}
							busy={busy}
						/>
					</div>
				) : (
					<div className="db-group-stack">
						{groups.map((g) => {
							const gSummary = 'summary' in g && g.summary ? g.summary : summarizeRows(g.rows);
							return (
								<details
									key={g.key}
									className="db-group-section"
									open
									onToggle={(e) => {
										e.currentTarget.open = true;
									}}
								>
									<summary className="db-group-summary">
										<strong style={{ fontFamily: 'inherit' }}>{g.label}</strong>
										<SummaryChips summary={gSummary} />
									</summary>
									<div className="database-table-wrap">
										<MatchTable
											rows={g.rows}
											sortKey={sortKey}
											sortMark={sortMark}
											onToggleSort={onToggleSort}
											selectedRowId={selectedRowId}
											onSelectRow={onSelectRow}
											onDeleteRow={onDeleteRow}
											bust={bust}
											busy={busy}
										/>
									</div>
								</details>
							);
						})}
					</div>
				)}
			</div>
		</details>
	);
}

/**
 * Shared filter + sorted row model for Database View (middle chrome + tier tables).
 * @param items - Legend rows
 * @param annotations - Hit annotations
 * @param trainingFeedback - Training / freehand feedback
 * @param tierProgress - Per-tier progress snapshots
 * @param opts - Style-guide context for pathway labels / glyph preference
 */
export function useDatabaseViewModel(
	items: LegendItemRow[],
	annotations: Annotation[],
	trainingFeedback: TrainingFeedback[],
	tierProgress: TierProgressSnapshot[],
	opts?: {
		styleGuideProfile?: StyleGuideProfileBrief | null;
		pathwayLayers?: PathwayLayer[];
	},
): DatabaseViewModel {
	const [statusFilter, setStatusFilter] = useState<string>('all');
	const [tierFilter, setTierFilter] = useState<string>('all');
	const [pathwayFilter, setPathwayFilter] = useState('');
	const [labelFilter, setLabelFilter] = useState('');
	const [groupBy, setGroupBy] = useState<DatabaseGroupBy>('type');
	const [sortKey, setSortKey] = useState<SortKey>('code');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

	const profile = opts?.styleGuideProfile ?? null;
	const pathwayLayers = opts?.pathwayLayers ?? [];

	const allRows = useMemo(
		() =>
			buildDatabaseRows(items, annotations, trainingFeedback, {
				styleGuideProfile: profile,
				pathwayLayers,
			}),
		[items, annotations, trainingFeedback, profile, pathwayLayers],
	);

	const filtered = useMemo(() => {
		const q = labelFilter.trim().toLowerCase();
		const pathQ = pathwayFilter.trim().toLowerCase();
		const list = allRows.filter((row) => {
			if (statusFilter !== 'all' && row.status !== statusFilter) return false;
			if (tierFilter !== 'all' && String(row.tier ?? '') !== tierFilter) return false;
			if (pathQ && !row.pathway.toLowerCase().includes(pathQ)) return false;
			if (
				q &&
				!`${row.code} ${row.name}`.toLowerCase().includes(q) &&
				!(row.difficultyNote || '').toLowerCase().includes(q)
			) {
				return false;
			}
			return true;
		});
		return sortRows(list, sortKey, sortDir);
	}, [allRows, statusFilter, tierFilter, pathwayFilter, labelFilter, sortKey, sortDir]);

	const rowsByTier = useMemo(() => {
		const map = new Map<number, DatabaseMatchRow[]>();
		for (const tier of TIER_ORDER) map.set(tier, []);
		for (const row of filtered) {
			const t = row.tier ?? 0;
			const list = map.get(t) || [];
			list.push(row);
			map.set(t, list);
		}
		return TIER_ORDER.map((tier) => ({
			tier,
			rows: map.get(tier) || [],
			progress: tierProgress.find((p) => p.tier === tier),
		})).filter((section) => {
			if (tierFilter !== 'all' && String(section.tier) !== tierFilter) return false;
			return section.rows.length > 0 || tierFilter !== 'all';
		});
	}, [filtered, tierProgress, tierFilter]);

	/**
	 * Toggle sort column or flip direction when the same column is clicked.
	 * @param key - Column sort key
	 */
	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortKey(key);
			setSortDir('asc');
		}
	}

	/**
	 * Column header sort indicator glyph.
	 * @param key - Column sort key
	 */
	function sortMark(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' ↑' : ' ↓';
	}

	return {
		statusFilter,
		setStatusFilter,
		tierFilter,
		setTierFilter,
		pathwayFilter,
		setPathwayFilter,
		labelFilter,
		setLabelFilter,
		groupBy,
		setGroupBy,
		sortKey,
		sortDir,
		toggleSort,
		sortMark,
		allRows,
		filtered,
		rowsByTier,
	};
}

/**
 * Middle-panel Database View: per-tier expandable tables with nested grouping,
 * row icons, and a minimal status/search chrome (left rail is ImageViewPanel).
 */
export function DatabasePipelinePage({
	model,
	findings,
	job,
	tierProgress,
	tierToTest,
	beforeProgress,
	afterProgress,
	selectedRowId = null,
	bust = 0,
	busy = false,
	onSelectRow,
	onOpenInReview,
	onDeleteRow,
}: Props) {
	return (
		<div className="database-page database-page--embedded">
			<header className="database-page-header database-page-header--compact">
				<div>
					<h2>Database View</h2>
					<p className="muted">
						Tables organized by tier. Select a row to review on the right
						{onOpenInReview ? '; open in Image View from the review panel when needed' : ''}.
					</p>
					<p className="muted mono" style={{ marginTop: 0, fontSize: '0.75rem' }}>
						{model.filtered.length} / {model.allRows.length} rows · Tier to Test {tierToTest}
					</p>
				</div>
			</header>

			<div className="database-chrome-filters" aria-label="Database table filters">
				<label>
					Status
					<select
						value={model.statusFilter}
						disabled={busy}
						onChange={(e) => model.setStatusFilter(e.target.value)}
					>
						<option value="all">All</option>
						<option value="confirmed">Confirmed</option>
						<option value="unreviewed">Unreviewed</option>
						<option value="reassigned">Reassigned</option>
						<option value="pending">Pending (no hits)</option>
						<option value="freehand">Freehand classify</option>
					</select>
				</label>
				<label>
					Search
					<input
						type="search"
						value={model.labelFilter}
						disabled={busy}
						placeholder="code / name"
						onChange={(e) => model.setLabelFilter(e.target.value)}
					/>
				</label>
			</div>

			<section className="db-tier-stack">
				{model.rowsByTier.map(({ tier, rows, progress }) => (
					<TierTableSection
						key={tier}
						tier={tier}
						rows={rows}
						groupBy={model.groupBy}
						onGroupByChange={model.setGroupBy}
						defaultOpen={tier === tierToTest || (model.tierFilter !== 'all' && rows.length > 0)}
						tierProgress={progress}
						sortKey={model.sortKey}
						sortMark={model.sortMark}
						onToggleSort={model.toggleSort}
						selectedRowId={selectedRowId}
						onSelectRow={onSelectRow}
						onDeleteRow={onDeleteRow}
						bust={bust}
						busy={busy}
					/>
				))}
				{model.rowsByTier.every((s) => s.rows.length === 0) && (
					<p className="muted panel-section">No rows match the current filters.</p>
				)}
			</section>

			<details className="database-pipeline-section">
				<summary>Pipeline progress · before/after · job log</summary>
				<div className="database-pipeline-embed">
					<ProgressPanel
						findings={findings}
						job={job}
						tierProgress={tierProgress}
						tierToTest={tierToTest}
						beforeProgress={beforeProgress}
						afterProgress={afterProgress}
					/>
				</div>
			</details>
		</div>
	);
}
