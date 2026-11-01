import { expect, it } from 'vitest';

import { createLocaleSetting, preferredLocale } from './locale.ts';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

it('takes the first preferred language the page is shown in, by its primary subtag', () => {
  expect(preferredLocale(['ja-JP', 'en-US'])).toBe('ja');
  expect(preferredLocale(['fr-FR', 'JA'])).toBe('ja');
  expect(preferredLocale(['en-GB', 'ja'])).toBe('en');
  expect(preferredLocale(['fr', 'de'])).toBe('en');
  expect(preferredLocale([])).toBe('en');
});

it('starts from the language last chosen, else the preferred one', () => {
  const storage = memoryStorage();
  expect(createLocaleSetting(storage, ['ja-JP']).current()).toBe('ja');
  storage.items.set('motion-kit-preview:locale', 'en');
  expect(createLocaleSetting(storage, ['ja-JP']).current()).toBe('en');
  storage.items.set('motion-kit-preview:locale', 'klingon');
  expect(createLocaleSetting(storage, ['ja-JP']).current()).toBe('ja');
});

it('keeps a choice and tells the listeners, once per change', () => {
  const storage = memoryStorage();
  const setting = createLocaleSetting(storage, ['en']);
  const seen: string[] = [];
  const unsubscribe = setting.subscribe(() => seen.push(setting.current()));
  setting.choose('ja');
  setting.choose('ja');
  unsubscribe();
  setting.choose('en');
  expect(seen).toEqual(['ja']);
  expect(storage.items.get('motion-kit-preview:locale')).toBe('en');
});

it('switches for the page where the storage refuses to keep it', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const setting = createLocaleSetting(blocked, ['ja']);
  expect(setting.current()).toBe('ja');
  setting.choose('en');
  expect(setting.current()).toBe('en');
});
