import { describe, expect, it } from 'vitest';
import { fundingDocumentOnly } from './project-context';
const route = (search: string, pathname = '/p/2/energieplanung', hash = '') => ({
  pathname,
  search,
  hash,
});
describe('stacked funding document navigation', () => {
  it('keeps unsaved funding edits when opening or closing only the document dialog', () => {
    expect(
      fundingDocumentOnly(
        route('?funding_id=7'),
        route('?funding_id=7&funding_document=8&document_funding_id=7'),
      ),
    ).toBe(true);
    expect(
      fundingDocumentOnly(route('?funding_id=7&funding_document=8'), route('?funding_id=7')),
    ).toBe(true);
  });
  it('keeps the dirty guard for changing the funding record, project, page or hash', () => {
    expect(
      fundingDocumentOnly(route('?funding_id=7'), route('?funding_id=9&funding_document=8')),
    ).toBe(false);
    expect(
      fundingDocumentOnly(route(''), route('?funding_document=8', '/p/3/energieplanung')),
    ).toBe(false);
    expect(fundingDocumentOnly(route(''), route('?funding_document=8', '/p/2/dokumente'))).toBe(
      false,
    );
    expect(fundingDocumentOnly(route(''), route('?funding_document=8', undefined, '#other'))).toBe(
      false,
    );
  });
  it('does not exempt malformed or unrelated navigation', () => {
    expect(fundingDocumentOnly(route(''), route('?funding_document=invalid'))).toBe(false);
    expect(fundingDocumentOnly(route(''), route('?funding_document=0'))).toBe(false);
    expect(fundingDocumentOnly(route(''), route(''))).toBe(false);
  });
});
