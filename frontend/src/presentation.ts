import { useSyncExternalStore } from 'react';
import '../../static/presentation.js';
import type { Row } from './core';
export type DisplaySettings = {
  language: 'de';
  dateFormat: 'de' | 'iso' | 'slash';
  currencyDisplay: 'symbol' | 'code';
  unitDisplay: 'short' | 'long';
};
const display = () => (window as any).PHBDisplay;
const subscribe = (fn: () => void) => {
  window.addEventListener('phb-display-change', fn);
  return () => window.removeEventListener('phb-display-change', fn);
};
export function useDisplaySettings(): DisplaySettings {
  return JSON.parse(useSyncExternalStore(subscribe, () => display().snapshot()));
}
export const setDisplaySettings = (settings: Partial<DisplaySettings>) => display().set(settings);
export const displayDate = (value: unknown, options?: Intl.DateTimeFormatOptions): string =>
  display().date(value, options);
export const displayDateTime = (value: unknown): string => display().dateTime(value);
export const displayMoney = (value: unknown, currency = 'EUR'): string =>
  display().money(value, currency);
export const companyChoices = (
  rows: Row[],
  label?: (row: Row) => string,
): { value: string; label: string }[] => display().companyOptions(rows, label);
export function notifyCompanyFavorites() {
  window.dispatchEvent(new Event('phb-company-favorites'));
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      iframe.contentWindow?.dispatchEvent(new Event('phb-company-favorites'));
    } catch {}
  }
}
