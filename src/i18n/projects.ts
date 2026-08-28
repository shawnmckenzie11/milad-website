import type { CurrentProject } from '../data/currentProjects';
import type { Project } from '../lib/research';
import type { Locale } from './config';

/** Localized title, summary, and presentation overlay for a research program. */
export interface ProjectText {
	/** Public program title. */
	title: string;
	/** Short scholarly description. */
	summary: string;
	/** Short label for jump navigation and tabs. */
	shortLabel?: string;
	/** One-line scientific question. */
	question?: string;
	/** Domain tags shown as muted text. */
	domains?: string[];
	/** Experimental or analytic approaches. */
	methods?: string[];
	/** Who this theme is most relevant for. */
	audience?: string;
	/** Accessible description of the program figure. */
	figureAlt?: string;
	/** Short scholarly caption under the figure. */
	figureCaption?: string;
}

const CURRENT_PROJECT_TEXT: Record<string, Record<Locale, ProjectText>> = {
	'cannabis-use-development': {
		en: {
			title: 'Cannabis use and development',
			question: 'How does cannabis exposure during development shape lung and systemic health?',
			summary:
				'This program examines developmental windows of cannabis exposure and their consequences for respiratory and systemic outcomes, using cell-based models, animal studies, and clinical data.',
		},
		fr: {
			title: 'Consommation de cannabis et développement',
			question:
				"Comment l'exposition au cannabis pendant le développement façonne-t-elle la santé pulmonaire et systémique?",
			summary:
				"Ce programme examine les fenêtres développementales d'exposition au cannabis et leurs conséquences pour les issues respiratoires et systémiques, à l'aide de modèles cellulaires, d'études animales et de données cliniques.",
		},
	},
	'cannabis-delivery-methods': {
		en: {
			title: 'Cannabis delivery methods',
			question: 'Do smoke, vapour, and other delivery routes produce distinct biological effects?',
			summary:
				'This program compares cannabis delivery methods—including smoke and vapour—to understand how route of administration influences lung and systemic responses.',
		},
		fr: {
			title: "Modes d'administration du cannabis",
			question:
				'La fumée, la vapeur et les autres voies d’administration produisent-elles des effets biologiques distincts?',
			summary:
				"Ce programme compare les modes d'administration du cannabis — notamment la fumée et la vapeur — afin de comprendre comment la voie d'administration influence les réponses pulmonaires et systémiques.",
		},
	},
	'cannabis-aging-senescence': {
		en: {
			title: 'Cannabis and aging/senescence',
			question: 'How does cannabis exposure intersect with cellular senescence and aging in the lung?',
			summary:
				'This program investigates links between cannabis exposure, cellular senescence, and age-related changes in lung and systemic health.',
		},
		fr: {
			title: 'Cannabis, vieillissement et sénescence',
			question:
				"Comment l'exposition au cannabis s'articule-t-elle avec la sénescence cellulaire et le vieillissement dans le poumon?",
			summary:
				"Ce programme étudie les liens entre l'exposition au cannabis, la sénescence cellulaire et les changements liés à l'âge dans la santé pulmonaire et systémique.",
		},
	},
	'cannabis-immunomodulatory-therapy': {
		en: {
			title: 'Cannabis and immunomodulatory therapy',
			question: 'Can cannabis-related exposures inform immunomodulatory strategies in the lung?',
			summary:
				'This program explores cannabis-related inhaled exposures alongside immunomodulatory approaches relevant to lung inflammation and host defense.',
		},
		fr: {
			title: 'Cannabis et thérapie immunomodulatrice',
			question:
				"Les expositions liées au cannabis peuvent-elles éclairer des stratégies immunomodulatrices dans le poumon?",
			summary:
				"Ce programme explore les expositions inhalées liées au cannabis, de même que des approches immunomodulatrices pertinentes pour l'inflammation pulmonaire et la défense de l'hôte.",
		},
	},
};

const PROJECT_TEXT: Record<string, Record<Locale, ProjectText>> = {
	'cannabis-respiratory-health': {
		en: {
			title: 'Cannabis exposure and respiratory health',
			summary:
				'Investigating how cannabis smoke and dried cannabis use intersect with antiviral immunity, tobacco co-use, and respiratory outcomes.',
			shortLabel: 'Cannabis & lung',
			question: 'How does cannabis exposure reshape antiviral immunity and respiratory risk?',
			domains: ['Inhaled cannabis', 'Antiviral immunity', 'Tobacco co-use'],
			methods: ['Murine infection models', 'Longitudinal cohorts'],
			audience: 'Strong fit for trainees in mucosal immunology and cannabis toxicology.',
			figureAlt:
				'Heatmap and gene-ontology plot showing cannabis smoke suppressing influenza A–associated immune pathway upregulation in mouse lungs.',
			figureCaption: 'From Milad et al., ERJ Open Research, 2023.',
		},
		fr: {
			title: 'Exposition au cannabis et santé respiratoire',
			summary:
				"Étude de l'intersection entre la fumée de cannabis et l'usage de cannabis séché, l'immunité antivirale, la co-consommation de tabac et les issues respiratoires.",
			shortLabel: 'Cannabis et poumon',
			question:
				"Comment l'exposition au cannabis remodèle-t-elle l'immunité antivirale et le risque respiratoire?",
			domains: ['Cannabis inhalé', 'Immunité antivirale', 'Co-consommation de tabac'],
			methods: ["Modèles d'infection murine", 'Cohortes longitudinales'],
			audience:
				'Tout indiqué pour les stagiaires en immunologie muqueuse et en toxicologie du cannabis.',
			figureAlt:
				"Carte de chaleur et analyse d'ontologie génique montrant que la fumée de cannabis supprime l'induction des voies immunitaires associée à l'influenza A dans le poumon de souris.",
			figureCaption: 'Tirée de Milad et coll., ERJ Open Research, 2023.',
		},
	},
	'vaping-toxicology': {
		en: {
			title: 'Vaping product chemistry and airway immunity',
			summary:
				'Studying how constituents of vaping liquids—including flavor chemicals and glycerol—shape pulmonary immune responses and metabolic effects.',
			shortLabel: 'Vaping chemistry',
			question: 'Which constituents of vaping liquids drive airway immune and metabolic effects?',
			domains: ['Flavor chemicals', 'Glycerol toxicology', 'Airway immunity'],
			methods: ['Aerosol exposures', 'Pulmonary immunology', 'Metabolic readouts'],
			audience: 'Ideal for students interested in exposure science and innate immunity.',
			figureAlt:
				'TUNEL microscopy and viability assays comparing cannabidiol formulations in normal and fibrotic precision-cut lung slices.',
			figureCaption: 'From Milad et al., Toxicol and Appl Pharmacol, unpublished.',
		},
		fr: {
			title: 'Chimie des produits de vapotage et immunité des voies aériennes',
			summary:
				"Étude de la façon dont les constituants des liquides de vapotage — notamment les substances aromatisantes et le glycérol — façonnent les réponses immunitaires pulmonaires et les effets métaboliques.",
			shortLabel: 'Chimie du vapotage',
			question:
				'Quels constituants des liquides de vapotage déterminent les effets immunitaires et métaboliques dans les voies aériennes?',
			domains: ['Substances aromatisantes', 'Toxicologie du glycérol', 'Immunité des voies aériennes'],
			methods: ['Expositions aux aérosols', 'Immunologie pulmonaire', 'Mesures métaboliques'],
			audience:
				"Idéal pour les étudiantes et étudiants intéressés par la science des expositions et l'immunité innée.",
			figureAlt:
				"Microscopie TUNEL et dosages de viabilité comparant des formulations de cannabidiol dans des coupes de poumon de précision normales et fibrotiques.",
			figureCaption: 'Tirée de Milad et coll., Toxicol and Appl Pharmacol, non publié.',
		},
	},
	'smoke-lung-inflammation': {
		en: {
			title: 'Cigarette smoke, inflammation, and lung homeostasis',
			summary:
				'Mechanistic work on smoke-driven lung inflammation, genetic emphysema risk, immune cell signaling, surfactant biology, and treatment responses in preclinical and tissue models.',
			shortLabel: 'Smoke & inflammation',
			question: 'How do smoke exposures disrupt lung immune homeostasis?',
			domains: ['Emphysema genetics', 'Neutrophils', 'Surfactant biology'],
			methods: ['Preclinical smoke models', 'Tissue transcriptomics', 'Immune phenotyping'],
			audience: 'Suited to trainees in lung immunology, COPD biology, and host defense.',
			figureAlt:
				'Schematic of IL-1α signaling among alveolar macrophages, epithelial cells, and neutrophils maintaining surfactant after cigarette smoke exposure.',
			figureCaption: 'From Milad et al., J Immunol, 2021.',
		},
		fr: {
			title: 'Fumée de cigarette, inflammation et homéostasie pulmonaire',
			summary:
				"Travaux mécanistiques sur l'inflammation pulmonaire liée à la fumée, le risque génétique d'emphysème, la signalisation des cellules immunitaires, la biologie du surfactant et les réponses au traitement dans des modèles précliniques et tissulaires.",
			shortLabel: 'Fumée et inflammation',
			question:
				"Comment les expositions à la fumée perturbent-elles l'homéostasie immunitaire pulmonaire?",
			domains: ["Génétique de l'emphysème", 'Neutrophiles', 'Biologie du surfactant'],
			methods: [
				"Modèles précliniques d'exposition à la fumée",
				'Transcriptomique tissulaire',
				'Phénotypage immunitaire',
			],
			audience:
				"Adapté aux stagiaires en immunologie pulmonaire, en biologie de la MPOC et en défense de l'hôte.",
			figureAlt:
				"Schéma de la signalisation IL-1α entre macrophages alvéolaires, cellules épithéliales et neutrophiles maintenant le surfactant après exposition à la fumée de cigarette.",
			figureCaption: 'Tirée de Milad et coll., J Immunol, 2021.',
		},
	},
	'airway-methods': {
		en: {
			title: 'Open methods for airway exposure studies',
			summary:
				'Building accessible experimental tools and methods for human airway epithelial research, including exposure systems and epithelial physiology assays.',
			shortLabel: 'Airway methods',
			question: 'Can open tools make human airway exposure studies more rigorous and shareable?',
			domains: ['Airway epithelium', 'Open hardware', 'CFTR physiology'],
			methods: ['Air–liquid interface culture', '3D-printed exposure systems', 'Epithelial assays'],
			audience: 'Good match for engineers and biologists building experimental platforms.',
			figureAlt:
				'Photographs of open-source 3D-printed 6-well and 24-well manifolds for air–liquid interface exposure studies.',
			figureCaption: 'From Singer, Milad, et al., ERJ Open Research, 2025.',
		},
		fr: {
			title: "Méthodes ouvertes pour les études d'exposition des voies aériennes",
			summary:
				"Mise au point d'outils et de méthodes expérimentaux accessibles pour la recherche sur l'épithélium des voies aériennes humaines, y compris des systèmes d'exposition et des dosages de physiologie épithéliale.",
			shortLabel: 'Méthodes des voies aériennes',
			question:
				"Des outils ouverts peuvent-ils rendre plus rigoureuses et plus partageables les études d'exposition des voies aériennes humaines?",
			domains: ['Épithélium des voies aériennes', 'Matériel ouvert', 'Physiologie du CFTR'],
			methods: [
				"Culture à l'interface air-liquide",
				"Systèmes d'exposition imprimés en 3D",
				'Dosages épithéliaux',
			],
			audience:
				'Convient aux ingénieurs et aux biologistes qui conçoivent des plateformes expérimentales.',
			figureAlt:
				"Photographies de collecteurs libres imprimés en 3D pour plaques de 6 et 24 puits, destinés aux études d'exposition à l'interface air-liquide.",
			figureCaption: 'Tirée de Singer, Milad, et coll., ERJ Open Research, 2025.',
		},
	},
	'neuromuscular-vascular': {
		en: {
			title: 'Neuromuscular and vascular disease models',
			summary:
				'Collaborative work on muscular dystrophy, Marfan-related vascular remodeling, and related metabolic or pharmacological interventions.',
			shortLabel: 'Neuromuscular and vascular disease model',
			question: 'How do metabolic and vascular pathways modify Marfan and muscular dystrophy phenotypes?',
			domains: ['Marfan aortopathy', 'Muscular dystrophy', 'Lipid metabolism'],
			methods: ['Genetic mouse models', 'Pharmacology', 'Vascular phenotyping'],
			audience: 'Relevant to collaborators in cardiovascular and neuromuscular disease.',
			figureAlt:
				'Masson’s trichrome histology and composition graphs of gastrocnemius muscle in wild-type, ApoE, mdx, and mdx-ApoE mice on chow versus Western diets.',
			figureCaption: 'From Milad et al., Skeletal Muscle, 2017.',
		},
		fr: {
			title: 'Modèles de maladies neuromusculaires et vasculaires',
			summary:
				'Travaux collaboratifs sur la dystrophie musculaire, le remodelage vasculaire lié au syndrome de Marfan, et des interventions métaboliques ou pharmacologiques connexes.',
			shortLabel: 'Modèle de maladie neuromusculaire et vasculaire',
			question:
				'Comment les voies métaboliques et vasculaires modifient-elles les phénotypes du syndrome de Marfan et des dystrophies musculaires?',
			domains: ['Aortopathie de Marfan', 'Dystrophie musculaire', 'Métabolisme lipidique'],
			methods: ['Modèles murins génétiques', 'Pharmacologie', 'Phénotypage vasculaire'],
			audience:
				'Pertinent pour les collaborateurs en maladies cardiovasculaires et neuromusculaires.',
			figureAlt:
				"Histologie au trichrome de Masson et graphiques de composition du muscle gastrocnémien chez des souris de type sauvage, ApoE, mdx et mdx-ApoE sous régime standard ou occidental.",
			figureCaption: 'Tirée de Milad et coll., Skeletal Muscle, 2017.',
		},
	},
	'other-recent': {
		en: {
			title: 'Collaborative respiratory research',
			summary: 'Collaborative studies in respiratory physiology and related clinical research.',
			shortLabel: 'Collaborative respiratory research',
			question:
				'Where do endothelial repair programs and clinical respiratory studies intersect the lab’s work?',
			domains: ['Endothelial biology', 'Clinical physiology', 'Collaborative studies'],
			methods: ['Translational collaborations', 'Tissue and clinical datasets'],
			audience: 'For visitors exploring adjacent collaborative programs.',
			figureAlt:
				'Western blot, immunofluorescence, and quantification of γH2AX and Lamin B1 in bleomycin-treated precision-cut lung slices from normal and iUIP tissue.',
			figureCaption: 'Miura, Milad, et al., Aging, 2025.',
		},
		fr: {
			title: 'Recherche respiratoire collaborative',
			summary:
				'Études collaboratives en physiologie respiratoire et en recherche clinique connexe.',
			shortLabel: 'Recherche respiratoire collaborative',
			question:
				'Où les programmes de réparation endothéliale et les études cliniques en physiologie respiratoire rejoignent-ils les travaux du laboratoire?',
			domains: ['Biologie endothéliale', 'Physiologie clinique', 'Études collaboratives'],
			methods: ['Collaborations translationnelles', 'Jeux de données tissulaires et cliniques'],
			audience: 'Pour les visiteurs qui explorent des programmes collaboratifs connexes.',
			figureAlt:
				"Immunobuvardage, immunofluorescence et quantification de γH2AX et de la lamine B1 dans des coupes de poumon de précision traitées à la bléomycine, à partir de tissus normaux et d'iUIP.",
			figureCaption: 'Miura, Milad, et coll., Aging, 2025.',
		},
	},
};

/**
 * Returns localized title and summary for a current-project card.
 * @param project - Authored current program
 * @param locale - Active site locale
 */
export function getCurrentProjectText(project: CurrentProject, locale: Locale): ProjectText {
	const overlay = CURRENT_PROJECT_TEXT[project.id]?.[locale];
	if (overlay) {
		return overlay;
	}
	return { title: project.title, question: project.question, summary: project.summary };
}

/**
 * Returns localized current programs in display order.
 * @param projects - Authored current programs
 * @param locale - Active site locale
 */
export function getLocalizedCurrentProjects(
	projects: CurrentProject[],
	locale: Locale,
): CurrentProject[] {
	return projects.map((project) => {
		const text = getCurrentProjectText(project, locale);
		return {
			...project,
			title: text.title,
			question: text.question ?? project.question,
			summary: text.summary,
		};
	});
}

/**
 * Returns localized copy overlay for a synced previous-project theme.
 * @param project - Synced project record
 * @param locale - Active site locale
 */
export function getProjectText(project: Project, locale: Locale): ProjectText {
	const overlay = PROJECT_TEXT[project.id]?.[locale];
	if (overlay) {
		return overlay;
	}
	return { title: project.title, summary: project.summary };
}
