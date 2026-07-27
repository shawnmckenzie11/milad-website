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

const PRESENTATION: Record<string, ProjectPresentation> = {
	'cannabis-respiratory-health': {
		shortLabel: 'Cannabis & lung',
		question: 'How does cannabis exposure reshape antiviral immunity and respiratory risk?',
		domains: ['Inhaled cannabis', 'Antiviral immunity', 'Tobacco co-use'],
		methods: ['Murine infection models', 'Longitudinal cohorts'],
		audience: 'Strong fit for trainees in mucosal immunology and cannabis toxicology.',
		accent: '#4a6274',
		icon: 'lung',
		figure: '/figures/projects/cannabis-lung.jpg',
		figureAlt:
			'Multi-panel figure showing cannabis smoke suppressing antiviral immune mediators after influenza A infection in mice.',
		figureCaption: 'From Milad et al., ERJ Open Research, 2023.',
	},
	'vaping-toxicology': {
		shortLabel: 'Vaping chemistry',
		question: 'Which constituents of vaping liquids drive airway immune and metabolic effects?',
		domains: ['Flavor chemicals', 'Glycerol toxicology', 'Airway immunity'],
		methods: ['Aerosol exposures', 'Pulmonary immunology', 'Metabolic readouts'],
		audience: 'Ideal for students interested in exposure science and innate immunity.',
		accent: '#5a7386',
		icon: 'droplet',
		figure: '/figures/projects/vaping-immunity.jpg',
		figureAlt:
			'Figure summarizing sex-dependent hepatic triglyceride and phosphatidylcholine changes after glycerol e-cigarette aerosol exposure.',
		figureCaption: 'From Lechasseur, Milad, et al., Physiological Reports, 2022.',
	},
	'smoke-lung-inflammation': {
		shortLabel: 'Smoke & inflammation',
		question: 'How do smoke exposures disrupt lung immune homeostasis?',
		domains: ['Emphysema genetics', 'Neutrophils', 'Surfactant biology'],
		methods: ['Preclinical smoke models', 'Tissue transcriptomics', 'Immune phenotyping'],
		audience: 'Suited to trainees in lung immunology, COPD biology, and host defense.',
		accent: '#6d7f8c',
		icon: 'alveolus',
		figure: '/figures/projects/smoke-inflammation.jpg',
		figureAlt:
			'Summary schematic of anti-IL-1α treatment effects on neutrophils and alveolar macrophages during smoking versus cessation.',
		figureCaption: 'From Milad et al., Frontiers in Pharmacology, 2022.',
	},
	'airway-methods': {
		shortLabel: 'Airway methods',
		question: 'Can open tools make human airway exposure studies more rigorous and shareable?',
		domains: ['Airway epithelium', 'Open hardware', 'CFTR physiology'],
		methods: ['Air–liquid interface culture', '3D-printed exposure systems', 'Epithelial assays'],
		audience: 'Good match for engineers and biologists building experimental platforms.',
		accent: '#4a6274',
		icon: 'hex',
		figure: '/figures/projects/airway-methods.jpg',
		figureAlt:
			'Photographs of open-source 3D-printed 6-well and 24-well manifolds for air–liquid interface exposure studies.',
		figureCaption: 'From Singer, Milad, et al., ERJ Open Research, 2025.',
	},
	'neuromuscular-vascular': {
		shortLabel: 'Muscle & vessels',
		question: 'How do metabolic and vascular pathways modify Marfan and muscular dystrophy phenotypes?',
		domains: ['Marfan aortopathy', 'Muscular dystrophy', 'Lipid metabolism'],
		methods: ['Genetic mouse models', 'Pharmacology', 'Vascular phenotyping'],
		audience: 'Relevant to collaborators in cardiovascular and neuromuscular disease.',
		accent: '#7a8792',
		icon: 'vessel',
		figure: '/figures/projects/muscle-vessels.jpg',
		figureAlt:
			'Figure showing telmisartan attenuating Marfan-associated aortic wall remodeling and p-ERK signaling in mice.',
		figureCaption: 'From Tehrani, Milad, et al., Scientific Reports, 2022.',
	},
	'other-recent': {
		shortLabel: 'Collaborations',
		question: 'Where do endothelial repair programs and clinical respiratory studies intersect the lab’s work?',
		domains: ['Endothelial biology', 'Clinical physiology', 'Collaborative studies'],
		methods: ['Translational collaborations', 'Tissue and clinical datasets'],
		audience: 'For visitors exploring adjacent collaborative programs.',
		accent: '#5a6d7a',
		icon: 'network',
		figure: '/figures/projects/collaborations.jpg',
		figureAlt:
			'Figure characterizing CD146⁺ endothelial and pericyte populations in rheumatoid arthritis pannus tissue.',
		figureCaption: 'From Miura, Milad, et al., Research Square preprint, 2026.',
	},
};

const FALLBACK_ACCENT = '#4a6274';

/**
 * Returns presentation metadata for a synced project, with safe fallbacks.
 */
export function getProjectPresentation(project: Project): ProjectPresentation {
	return (
		PRESENTATION[project.id] ?? {
			shortLabel: project.title,
			question: project.summary,
			domains: [],
			methods: [],
			audience: '',
			accent: FALLBACK_ACCENT,
			icon: 'network',
			figure: '/figures/projects/collaborations.jpg',
			figureAlt: `Research figure for ${project.title}.`,
			figureCaption: project.title,
		}
	);
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
