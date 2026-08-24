/**
 * Visitor-facing copy for English (default) and French.
 * Publication titles, proper names, and email addresses stay in their original form.
 */
export const en = {
	site: {
		labName: 'Milad Lab',
		affiliation: 'University of Ottawa',
		name: 'Dr. Nadia Milad',
		researchFocus: 'Cannabis research and evidence synthesis',
	},
	nav: {
		home: 'Home',
		publications: 'Publications',
		projects: 'Projects',
		join: 'Work With Us',
		brandAria: 'Milad Lab home',
		primaryAria: 'Primary',
	},
	language: {
		label: 'Language',
		en: 'English',
		fr: 'Français',
	},
	home: {
		aboutHeading: 'About Dr. Nadia Milad',
		lungAlt: 'Stylized illustration of the lungs',
		wordmarkAlt: 'Milad Lab',
		skylineAlt: 'Ottawa skyline with Parliament Hill',
		bio: 'Dr. Nadia Milad completed her B.Sc., M.Sc. and PhD in pharmacology at McGill University, University of British Columbia, and Université Laval, respectively. After her postdoctoral training at McMaster University and Nagoya City University, she became an Assistant Professor in the School of Pharmaceutical Sciences at the University of Ottawa. Although her previous research spans several topics, her recent focus has been on the health impacts of smoke exposures. Currently, her translational research program will explore the lung and systemic effects of cannabis use, using a combination of in vitro cell culture techniques, in vivo animal models, and clinical data.',
	},
	publications: {
		metaTitle: 'Publications',
		metaDescription: 'Selected publications by {name}, {affiliation}.',
		heading: 'Selected Publications',
		empty: 'No publications listed yet.',
		viewAll: 'View the complete publication list',
		allMetaTitle: 'All Publications',
		allMetaDescription: 'Complete publication list by {name}, {affiliation}.',
		allEyebrow: 'Publications',
		allHeading: 'All Publications',
		backToSelected: 'Back to selected publications',
		types: {
			journal: 'journal',
			preprint: 'preprint',
			chapter: 'chapter',
			other: 'other',
		},
	},
	projects: {
		metaTitle: 'Projects',
		metaDescription:
			'Research programs led by {name} — for prospective trainees and collaborators in biology and health sciences.',
		currentHeading: 'Current Projects',
		currentIntro:
			'Ongoing programs in the lab examining cannabis exposure, delivery, aging, and immune modulation.',
		previousHeading: 'Previous Projects',
		previousIntro: 'Earlier and collaborative programs that inform current directions.',
		previousTabsLabel: 'Previous research programs',
		programsLabel: 'Research programs',
		approachesHeading: 'Approaches in the lab',
		approachesIntro:
			'Common experimental and analytic threads across programs — useful for matching skills and training goals.',
		engageHeading: 'Join or collaborate',
		engageIntro: 'Two clear entry points depending on whether you are seeking training or partnership.',
		studentsHeading: 'Prospective students',
		studentsBody:
			'If your interests align with a program above — especially inhaled exposures, lung immunity, or epithelial methods — start with a short note of interest.',
		studentsCta: 'Work with us',
		collaboratorsHeading: 'Scientists & collaborators',
		collaboratorsBody:
			'For shared experiments, methods, or cannabis literature workflows, reach out directly.',
		emailLab: 'Email the lab',
		readPublications: 'Read publications',
		approachesLabel: 'Approaches',
		evidenceHeading: 'Evidence snapshot',
		relatedCount: '+{count} related',
		browsePublications: 'Browse full publication list',
		joinProject: 'Interested in this project? Join Us!',
		status: {
			active: 'active',
			completed: 'completed',
		},
	},
	join: {
		metaTitle: 'Work With Us',
		metaDescription: 'Opportunities to train with the lab or explore research collaborations.',
		eyebrow: 'Prospective researchers',
		heading: 'Work With Us',
		teamHeading: 'Join our team',
		teamBody:
			'Our team is growing! We are currently recruiting motivated candidates at the following levels: undergraduate summer interns, coop students, Masters students, and doctoral students. Feel free to use the form below to contact our team and we will get back to you as soon as possible.',
		collabHeading: 'Work with us',
		collabBody:
			'Our research group is always looking for collaborators and partnerships. We have the expertise and technical ability to study a variety of inhaled exposures (cigarette smoke, wood fire smoke, cannabis smoke, e-cigarettes, cannabis vapour) at the in vitro and in vivo levels. If you would like to explore how these smoke/vapour exposures affect your tissue or disease of interest, please get in touch with us through the form below.',
	},
	joinForm: {
		requiredNote: 'Required fields are marked with an asterisk (*).',
		name: 'Name',
		email: 'Email address',
		program: 'Program of interest',
		programPlaceholder: 'Select a program',
		programs: {
			coop: 'Co-op',
			undergrad: 'Undergraduate',
			masters: "Master's",
			phd: 'Doctoral',
			postdoc: 'Postdoctoral',
			staff: 'Staff',
			collaboration: 'Collaboration',
		},
		eligibility: 'Work eligibility',
		eligibilityPlaceholder: 'Select if applicable',
		eligibilityOptions: {
			'permanent-resident': 'Permanent Resident',
			'canadian-citizen': 'Canadian Citizen',
			international: 'International',
		},
		comments: 'Comments',
		commentsHint:
			'Tell us a little about yourself, your interest in research, your goals long-term and how we can help you.',
		attachments: 'Attachments',
		attachmentsHint: 'CV, publications, or related documents (PDF preferred).',
		submit: 'Send message',
		noscript:
			'JavaScript is required to prepare this form. Please email {email} with your name, program of interest, and CV.',
		errorName: 'Please enter your name.',
		errorEmail: 'Please enter a valid email address.',
		errorProgram: 'Please select a program of interest.',
		missingDestination: 'This form is missing a destination address. Please try again later.',
		statusOpened:
			'Your email client will open with this message. Attach any files before sending to complete your inquiry.',
		notSpecified: 'Not specified',
		mailtoName: 'Name',
		mailtoEmail: 'Email',
		mailtoProgram: 'Program of interest',
		mailtoEligibility: 'Work eligibility',
		mailtoComments: 'Comments',
		mailtoNone: '(none)',
		mailtoAttachments: 'Attachments to include',
		mailtoAttachNote: 'Please attach these files in your email client before sending.',
		mailtoSubject: 'Work With Us — {program}',
		mailtoSubjectFallback: 'Inquiry',
	},
} as const;

export const fr: typeof en = {
	site: {
		labName: 'Milad Lab',
		affiliation: "Université d'Ottawa",
		name: 'Dre Nadia Milad',
		researchFocus: 'Recherche sur le cannabis et synthèse des données',
	},
	nav: {
		home: 'Accueil',
		publications: 'Publications',
		projects: 'Projets',
		join: 'Nous joindre',
		brandAria: 'Accueil du Milad Lab',
		primaryAria: 'Navigation principale',
	},
	language: {
		label: 'Langue',
		en: 'English',
		fr: 'Français',
	},
	home: {
		aboutHeading: 'À propos de la Dre Nadia Milad',
		lungAlt: 'Illustration stylisée des poumons',
		wordmarkAlt: 'Milad Lab',
		skylineAlt: 'Horizon d’Ottawa et colline du Parlement',
		bio: "La Dre Nadia Milad a obtenu son B. Sc., son M. Sc. et son doctorat en pharmacologie à l'Université McGill, à l'University of British Columbia et à l'Université Laval, respectivement. Après une formation postdoctorale à McMaster University et à Nagoya City University, elle a été nommée professeure adjointe à l'École des sciences pharmaceutiques de l'Université d'Ottawa. Bien que ses travaux antérieurs portent sur plusieurs sujets, ses recherches récentes portent sur les effets de l'exposition à la fumée sur la santé. Son programme de recherche translationnelle explore actuellement les effets pulmonaires et systémiques de la consommation de cannabis, en combinant des techniques de culture cellulaire in vitro, des modèles animaux in vivo et des données cliniques.",
	},
	publications: {
		metaTitle: 'Publications',
		metaDescription: 'Publications sélectionnées de {name}, {affiliation}.',
		heading: 'Publications sélectionnées',
		empty: "Aucune publication n'est affichée pour le moment.",
		viewAll: 'Consulter la liste complète des publications',
		allMetaTitle: 'Toutes les publications',
		allMetaDescription: 'Liste complète des publications de {name}, {affiliation}.',
		allEyebrow: 'Publications',
		allHeading: 'Toutes les publications',
		backToSelected: 'Retour aux publications sélectionnées',
		types: {
			journal: 'revue',
			preprint: 'prépublication',
			chapter: 'chapitre',
			other: 'autre',
		},
	},
	projects: {
		metaTitle: 'Projets',
		metaDescription:
			'Programmes de recherche dirigés par {name} — destinés aux stagiaires et collaborateurs en biologie et en sciences de la santé.',
		currentHeading: 'Projets en cours',
		currentIntro:
			"Programmes en cours au laboratoire portant sur l'exposition au cannabis, les modes d'administration, le vieillissement et la modulation immunitaire.",
		previousHeading: 'Projets antérieurs',
		previousIntro: 'Programmes antérieurs et collaboratifs qui éclairent les orientations actuelles.',
		previousTabsLabel: 'Programmes de recherche antérieurs',
		programsLabel: 'Programmes de recherche',
		approachesHeading: 'Approches au laboratoire',
		approachesIntro:
			'Fils conducteurs expérimentaux et analytiques communs aux programmes — utiles pour apparier les compétences et les objectifs de formation.',
		engageHeading: "Joindre l'équipe ou collaborer",
		engageIntro:
			'Deux points d’entrée distincts, selon que vous souhaitez une formation ou un partenariat.',
		studentsHeading: 'Étudiantes et étudiants',
		studentsBody:
			'Si vos intérêts rejoignent un programme ci-dessus — en particulier les expositions inhalées, l’immunité pulmonaire ou les méthodes épithéliales — commencez par une courte note d’intérêt.',
		studentsCta: 'Travailler avec nous',
		collaboratorsHeading: 'Scientifiques et collaborateurs',
		collaboratorsBody:
			'Pour des expériences partagées, des méthodes ou des flux de travail sur la littérature cannabis, écrivez-nous directement.',
		emailLab: 'Écrire au laboratoire',
		readPublications: 'Lire les publications',
		approachesLabel: 'Approches',
		evidenceHeading: 'Aperçu des travaux',
		relatedCount: '+{count} connexes',
		browsePublications: 'Consulter la liste complète des publications',
		joinProject: 'Ce projet vous intéresse? Joignez-vous à nous!',
		status: {
			active: 'en cours',
			completed: 'terminé',
		},
	},
	join: {
		metaTitle: 'Travailler avec nous',
		metaDescription:
			'Possibilités de formation au laboratoire ou de collaborations de recherche.',
		eyebrow: 'Chercheuses et chercheurs intéressés',
		heading: 'Travailler avec nous',
		teamHeading: 'Joindre notre équipe',
		teamBody:
			'Notre équipe s’agrandit! Nous recrutons actuellement des candidates et candidats motivés aux niveaux suivants : stages d’été au premier cycle, étudiantes et étudiants en coop, à la maîtrise et au doctorat. N’hésitez pas à nous écrire au moyen du formulaire ci-dessous; nous vous répondrons dès que possible.',
		collabHeading: 'Collaborer avec nous',
		collabBody:
			'Notre groupe de recherche est toujours ouvert aux collaborations et aux partenariats. Nous disposons de l’expertise et des moyens techniques pour étudier diverses expositions inhalées (fumée de cigarette, fumée de bois, fumée de cannabis, cigarettes électroniques, vapeur de cannabis) aux niveaux in vitro et in vivo. Si vous souhaitez explorer les effets de ces expositions à la fumée ou à la vapeur sur un tissu ou une maladie d’intérêt, veuillez nous contacter au moyen du formulaire ci-dessous.',
	},
	joinForm: {
		requiredNote: 'Les champs obligatoires sont indiqués par un astérisque (*).',
		name: 'Nom',
		email: 'Adresse courriel',
		program: 'Programme d’intérêt',
		programPlaceholder: 'Sélectionnez un programme',
		programs: {
			coop: 'Coop',
			undergrad: 'Premier cycle',
			masters: 'Maîtrise',
			phd: 'Doctorat',
			postdoc: 'Stage postdoctoral',
			staff: 'Personnel',
			collaboration: 'Collaboration',
		},
		eligibility: 'Admissibilité au travail',
		eligibilityPlaceholder: 'Sélectionnez le cas échéant',
		eligibilityOptions: {
			'permanent-resident': 'Résident permanent',
			'canadian-citizen': 'Citoyen canadien',
			international: 'International',
		},
		comments: 'Commentaires',
		commentsHint:
			'Présentez-vous brièvement, votre intérêt pour la recherche, vos objectifs à long terme et la façon dont nous pouvons vous accompagner.',
		attachments: 'Pièces jointes',
		attachmentsHint: 'CV, publications ou documents connexes (PDF de préférence).',
		submit: 'Envoyer le message',
		noscript:
			'JavaScript est requis pour préparer ce formulaire. Veuillez écrire à {email} en indiquant votre nom, votre programme d’intérêt et votre CV.',
		errorName: 'Veuillez indiquer votre nom.',
		errorEmail: 'Veuillez indiquer une adresse courriel valide.',
		errorProgram: 'Veuillez sélectionner un programme d’intérêt.',
		missingDestination: 'Ce formulaire n’a pas d’adresse de destination. Veuillez réessayer plus tard.',
		statusOpened:
			'Votre logiciel de courriel s’ouvrira avec ce message. Joignez les fichiers avant l’envoi pour terminer votre demande.',
		notSpecified: 'Non précisé',
		mailtoName: 'Nom',
		mailtoEmail: 'Courriel',
		mailtoProgram: 'Programme d’intérêt',
		mailtoEligibility: 'Admissibilité au travail',
		mailtoComments: 'Commentaires',
		mailtoNone: '(aucun)',
		mailtoAttachments: 'Pièces à joindre',
		mailtoAttachNote: 'Veuillez joindre ces fichiers dans votre logiciel de courriel avant l’envoi.',
		mailtoSubject: 'Travailler avec nous — {program}',
		mailtoSubjectFallback: 'Demande de renseignements',
	},
};

export const messages = { en, fr } as const;

/** Visitor-facing message dictionary for one locale. */
export type Messages = typeof en;
