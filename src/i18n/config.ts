/** Supported public locales for the lab site. */
export const locales = ['en', 'fr'] as const;

/** Locale union derived from the configured public languages. */
export type Locale = (typeof locales)[number];

/** Default visitor language; English URLs have no locale prefix. */
export const defaultLocale: Locale = 'en';

/** localStorage key used to remember an explicit language choice. */
export const localeStorageKey = 'milad-lab-locale';
