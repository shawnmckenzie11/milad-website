export { defaultLocale, localeStorageKey, locales, type Locale } from './config';
export { messages, type Messages } from './messages';
export { getLocalizedCurrentProjects, getProjectText, type ProjectText } from './projects';
export {
	emphasizeLatinTerms,
	isLocale,
	localizePath,
	resolveLocale,
	stripLocalePrefix,
	switchLocalePath,
	translateProjectStatus,
	translatePublicationType,
	useTranslations,
} from './utils';
