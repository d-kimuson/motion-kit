import { z } from 'zod';

/** The languages the preview page is shown in; the first is the fallback. */
export const locales = ['en', 'ja'] as const;
export const localeSchema = z.enum(locales);
export type Locale = z.infer<typeof localeSchema>;

/** Each language's name, in that language, for the switch between them. */
export const localeNames: Readonly<Record<Locale, string>> = { en: 'English', ja: '日本語' };

/**
 * The first of the browser's preferred languages (`navigator.languages`) the page is shown in,
 * matched by its primary subtag (`ja-JP` is `ja`); English when none is.
 */
export const preferredLocale = (languages: readonly string[]): Locale => {
  for (const language of languages) {
    const parsed = localeSchema.safeParse(language.split('-')[0]?.toLowerCase());
    if (parsed.success) return parsed.data;
  }
  return 'en';
};

export type LocaleSetting = Readonly<{
  current: () => Locale;
  subscribe: (listener: () => void) => () => void;
  choose: (locale: Locale) => void;
}>;

const key = 'motion-kit-preview:locale';

/**
 * The language of the page: the one last chosen, kept in `localStorage` across reloads and for
 * every project, else the browser's preferred one. Storage is per origin, so a session on another
 * port starts from the browser's preference.
 */
export const createLocaleSetting = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  languages: readonly string[],
): LocaleSetting => {
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const stored = localeSchema.safeParse(read());
  let locale = stored.success ? stored.data : preferredLocale(languages);
  return {
    current: () => locale,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    choose: (next) => {
      if (next === locale) return;
      locale = next;
      // A blocked or full storage only forgets the choice at the next reload.
      try {
        storage.setItem(key, locale);
      } catch {
        // Nothing to keep it in.
      }
      for (const listener of listeners) listener();
    },
  };
};
