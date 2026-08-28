import { defaultLocale, type Locale } from '../i18n/config';
import { getProjectText } from '../i18n/projects';
import type { Project } from './research';

/** Inline icon ids rendered by ProjectIcon for each research program. */
export type ProjectIconId =
	| 'lung'
	| 'droplet'
	| 'alveolus'
	| 'hex'
	| 'vessel'
	| 'network';

/** Presentation metadata layered onto synced project themes for the public Projects page. */
export interface ProjectPresentation {
	/** Short label for jump navigation. */
	shortLabel: string;
	/** One-line scientific question for experts and trainees. */
	question: string;
	/** Domain tags shown as muted text (not decorative pills). */
	domains: string[];
	/** Experimental or analytic approaches. */
	methods: string[];
	/** Who this theme is most relevant for. */
	audience: string;
	/** Program accent hex used for edge, figure wash, and icon stroke. */
	accent: string;
	/** Glyph id for the title-row icon. */
	icon: ProjectIconId;
	/** Public path to the program figure (JPEG/PNG under public/). */
	figure: string;
	/** Accessible description of the program figure. */
	figureAlt: string;
	/** Short scholarly caption under the figure, with paper attribution. */
	figureCaption: string;
}

/** Display order for the Previous Projects list on /projects. */
export const PREVIOUS_PROJECT_IDS = [
	'cannabis-respiratory-health',
	'vaping-toxicology',
	'smoke-lung-inflammation',
	'airway-methods',
	'other-recent',
	'neuromuscular-vascular',
] as const;

const PRESENTATION: Record<string, ProjectPresentation> = {
	'cannabis-respiratory-health': {
		shortLabel: 'Cannabis & lung',
		question: 'How does cannabis exposure reshape antiviral immunity and respiratory risk?',
		domains: ['Inhaled cannabis', 'Antiviral immunity', 'Tobacco co-use'],
		methods: ['Murine infection models', 'Longitudinal cohorts'],
		audience: 'Strong fit for trainees in mucosal immunology and cannabis toxicology.',
		accent: '#00C064',
		icon: 'lung',
		figure: '/figures/projects/cannabis-lung.png',
		figureAlt:
			'Heatmap and gene-ontology plot showing cannabis smoke suppressing influenza A–associated immune pathway upregulation in mouse lungs.',
		figureCaption: 'From Milad et al., ERJ Open Research, 2023.',
	},
	'vaping-toxicology': {
		shortLabel: 'Vaping chemistry',
		question: 'Which constituents of vaping liquids drive airway immune and metabolic effects?',
		domains: ['Flavor chemicals', 'Glycerol toxicology', 'Airway immunity'],
		methods: ['Aerosol exposures', 'Pulmonary immunology', 'Metabolic readouts'],
		audience: 'Ideal for students interested in exposure science and innate immunity.',
		accent: '#00C064',
		icon: 'droplet',
		figure: '/figures/projects/vaping-chemistry.png',
		figureAlt:
			'TUNEL microscopy and viability assays comparing cannabidiol formulations in normal and fibrotic precision-cut lung slices.',
		figureCaption: 'From Milad et al., Toxicol and Appl Pharmacol, unpublished.',
	},
	'smoke-lung-inflammation': {
		shortLabel: 'Smoke & inflammation',
		question: 'How do smoke exposures disrupt lung immune homeostasis?',
		domains: ['Emphysema genetics', 'Neutrophils', 'Surfactant biology'],
		methods: ['Preclinical smoke models', 'Tissue transcriptomics', 'Immune phenotyping'],
		audience: 'Suited to trainees in lung immunology, COPD biology, and host defense.',
		accent: '#00C064',
		icon: 'alveolus',
		figure: '/figures/projects/smoke-inflammation.png',
		figureAlt:
			'Schematic of IL-1α signaling among alveolar macrophages, epithelial cells, and neutrophils maintaining surfactant after cigarette smoke exposure.',
		figureCaption: 'From Milad et al., J Immunol, 2021.',
	},
	'airway-methods': {
		shortLabel: 'Airway methods',
		question: 'Can open tools make human airway exposure studies more rigorous and shareable?',
		domains: ['Airway epithelium', 'Open hardware', 'CFTR physiology'],
		methods: ['Air–liquid interface culture', '3D-printed exposure systems', 'Epithelial assays'],
		audience: 'Good match for engineers and biologists building experimental platforms.',
		accent: '#00C064',
		icon: 'hex',
		figure: '/figures/projects/airway-methods.jpg',
		figureAlt:
			'Photographs of open-source 3D-printed 6-well and 24-well manifolds for air–liquid interface exposure studies.',
		figureCaption: 'From Singer, Milad, et al., ERJ Open Research, 2025.',
	},
	'neuromuscular-vascular': {
		shortLabel: 'Neuromuscular and vascular disease model',
		question: 'How do metabolic and vascular pathways modify Marfan and muscular dystrophy phenotypes?',
		domains: ['Marfan aortopathy', 'Muscular dystrophy', 'Lipid metabolism'],
		methods: ['Genetic mouse models', 'Pharmacology', 'Vascular phenotyping'],
		audience: 'Relevant to collaborators in cardiovascular and neuromuscular disease.',
		accent: '#00C064',
		icon: 'vessel',
		figure: '/figures/projects/neuromuscular-vascular.png',
		figureAlt:
			'Masson’s trichrome histology and composition graphs of gastrocnemius muscle in wild-type, ApoE, mdx, and mdx-ApoE mice on chow versus Western diets.',
		figureCaption: 'From Milad et al., Skeletal Muscle, 2017.',
	},
	'other-recent': {
		shortLabel: 'Collaborative respiratory research',
		question: 'Where do endothelial repair programs and clinical respiratory studies intersect the lab’s work?',
		domains: ['Endothelial biology', 'Clinical physiology', 'Collaborative studies'],
		methods: ['Translational collaborations', 'Tissue and clinical datasets'],
		audience: 'For visitors exploring adjacent collaborative programs.',
		accent: '#00C064',
		icon: 'network',
		figure: '/figures/projects/collaborative-respiratory.png',
		figureAlt:
			'Western blot, immunofluorescence, and quantification of γH2AX and Lamin B1 in bleomycin-treated precision-cut lung slices from normal and iUIP tissue.',
		figureCaption: 'Miura, Milad, et al., Aging, 2025.',
	},
};

const FALLBACK_ACCENT = '#00C064';

/**
 * Returns presentation metadata for a synced project, with locale overlays.
 * @param project - Synced project theme
 * @param locale - Active site locale
 */
export function getProjectPresentation(
	project: Project,
	locale: Locale = defaultLocale,
): ProjectPresentation {
	const base =
		PRESENTATION[project.id] ?? {
			shortLabel: project.title,
			question: project.summary,
			domains: [],
			methods: [],
			audience: '',
			accent: FALLBACK_ACCENT,
			icon: 'network' as const,
			figure: '/figures/projects/collaborative-respiratory.png',
			figureAlt: `Research figure for ${project.title}.`,
			figureCaption: project.title,
		};
	const overlay = getProjectText(project, locale);
	return {
		...base,
		shortLabel: overlay.shortLabel ?? base.shortLabel,
		question: overlay.question ?? base.question,
		domains: overlay.domains ?? base.domains,
		methods: overlay.methods ?? base.methods,
		audience: overlay.audience ?? base.audience,
		figureAlt: overlay.figureAlt ?? base.figureAlt,
		figureCaption: overlay.figureCaption ?? base.figureCaption,
	};
}

/**
 * Returns the localized public title for a synced project theme.
 * @param project - Synced project theme
 * @param locale - Active site locale
 */
export function getProjectDisplayTitle(project: Project, locale: Locale = defaultLocale): string {
	return getProjectText(project, locale).title;
}

/**
 * Parses year + title pairs from generated project body text.
 */
export function parseRelatedPublications(
	body: string,
): Array<{ year: string; title: string }> {
	const marker = 'Selected publications:\n';
	const legacyMarker = 'Recent related work:\n';
	const listBlock = body.includes(marker)
		? (body.split(marker)[1] ?? '')
		: body.includes(legacyMarker)
			? (body.split(legacyMarker)[1] ?? '')
			: '';

	return listBlock
		.split('\n')
		.map((line) => line.replace(/^- /, '').trim())
		.filter(Boolean)
		.map((line) => {
			const match = line.match(/^(\d{4})\s+[—–-]\s+(.+)$/);
			if (!match) {
				return { year: '', title: line };
			}
			return { year: match[1], title: match[2] };
		});
}
