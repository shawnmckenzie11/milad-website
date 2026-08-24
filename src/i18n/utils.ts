import { defaultLocale, locales, type Locale } from './config';
import { messages, type Messages } from './messages';

/**
 * Returns whether a string is a configured site locale.
 * @param value - Candidate locale code
 */
export function isLocale(value: string | undefined): value is Locale {
	return value !== undefined && (locales as readonly string[]).includes(value);
}

/**
 * Resolves Astro.currentLocale or a raw code to a supported locale.
 * @param value - Locale from the URL or document
 */
export function resolveLocale(value: string | undefined): Locale {
	return isLocale(value) ? value : defaultLocale;
}

/**
 * Strips a leading `/fr` prefix so English and French paths can be compared.
 * @param pathname - URL pathname
 */
export function stripLocalePrefix(pathname: string): string {
	const normalized = pathname.replace(/\/$/, '') || '/';
	if (normalized === '/fr') {
		return '/';
	}
	if (normalized.startsWith('/fr/')) {
		const rest = normalized.slice(3);
		return rest.startsWith('/') ? rest : `/${rest}`;
	}
	return normalized;
}

/**
 * Builds a locale-prefixed path for in-site navigation.
 * @param locale - Target locale
 * @param path - Unprefixed path such as `/` or `/publications`
 */
export function localizePath(locale: Locale, path: string): string {
	const withSlash = path.startsWith('/') ? path : `/${path}`;
	const normalized = withSlash.replace(/\/+$/, '') || '/';
	if (locale === defaultLocale) {
		return normalized;
	}
	return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

/**
 * Returns the same page in another locale, preserving an unprefixed path shape.
 * @param pathname - Current URL pathname
 * @param targetLocale - Locale to switch to
 */
export function switchLocalePath(pathname: string, targetLocale: Locale): string {
	return localizePath(targetLocale, stripLocalePrefix(pathname));
}

/**
 * Returns the visitor-facing message dictionary for a locale.
 * @param locale - Active site locale
 */
export function useTranslations(locale: Locale): Messages {
	return messages[locale];
}

/**
 * Wraps conventional Latin research terms in italics for HTML rendering.
 * @param text - Plain visitor-facing copy that may include in vitro / in vivo
 */
export function emphasizeLatinTerms(text: string): string {
	return text.replace(/\bin vitro\b/g, '<i>in vitro</i>').replace(/\bin vivo\b/g, '<i>in vivo</i>');
}

/**
 * Translates a publication type token for list metadata.
 * @param type - Synced publication type
 * @param locale - Active site locale
 */
export function translatePublicationType(
	type: 'journal' | 'preprint' | 'chapter' | 'other',
	locale: Locale,
): string {
	return useTranslations(locale).publications.types[type];
}

/**
 * Translates a project status token for program cards.
 * @param status - Synced project status
 * @param locale - Active site locale
 */
export function translateProjectStatus(
	status: 'active' | 'completed',
	locale: Locale,
): string {
	return useTranslations(locale).projects.status[status];
}
