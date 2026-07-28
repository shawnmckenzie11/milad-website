import type { Criteria } from '../types';

type Props = {
	criteria: Criteria | null | undefined;
	guidelinesFallback?: string;
};

/**
 * Collapsible banner summarizing observability tiers 0–3 and iconInterpretation.
 */
export function TierCriteriaBanner({ criteria, guidelinesFallback }: Props) {
	const tiers = criteria?.tiers ?? [
		{
			tier: 1,
			label: 'Top — exact replicas',
			summary:
				'Exact legend replicas in the diagram; find with high confidence first.',
			focus: true,
		},
		{
			tier: 2,
			label: 'Middle — partial / explicit marks',
			summary: 'Eventually find; not 100% replicas (~70% neighbor similarity).',
			focus: false,
		},
		{
			tier: 3,
			label: 'Lowest — scale / fractal hard',
			summary: 'Present but difficult; scale-divergent / <60% glyph similarity.',
			focus: false,
		},
		{
			tier: 0,
			label: 'Skip — not searchable',
			summary: 'Not properly diagrammed, or absent from the figure.',
			focus: false,
		},
	];

	const icons = criteria?.iconInterpretationHelp ?? {
		'1-discrete': 'Single glyph template',
		'2-discrete': 'Two glyphs side-by-side — search each independently',
		'multiple-adjacent-as-one': 'Adjacent multiples treated as one template',
	};

	return (
		<section className="criteria">
			<details open>
				<summary>Observability tier criteria (prompt guidelines)</summary>
				<p className="muted" style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
					{criteria?.guidelines || guidelinesFallback || ''}
				</p>
				<div className="criteria-grid">
					{tiers.map((t) => (
						<article key={t.tier} className={`criteria-card${t.focus ? ' focus' : ''}`}>
							<h3>
								Tier {t.tier}: {t.label}
							</h3>
							<p>{t.summary}</p>
						</article>
					))}
				</div>
				<div className="criteria-grid" style={{ marginTop: '0.55rem' }}>
					{Object.entries(icons).map(([key, help]) => (
						<article key={key} className="criteria-card">
							<h3>iconInterpretation · {key}</h3>
							<p>{help}</p>
						</article>
					))}
				</div>
			</details>
		</section>
	);
}
