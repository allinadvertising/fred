// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShopifyOnsitesParserPage from '@/app/onsites-parser/shopify/page';

const attachText = (file: File, text: string) => {
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(text)
  });
  return file;
};

describe('onsites parser shopify page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn()
      })
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('explains that Title is reserved for H1', () => {
    render(<ShopifyOnsitesParserPage />);

    expect(screen.getByRole('checkbox', { name: /Bypass H1 update/i })).toBeChecked();
    expect(screen.getByText(/only included when you turn off the bypass below/i)).toBeInTheDocument();
  });

  it('builds a product export and a separate exclusion file for non-product urls', async () => {
    render(<ShopifyOnsitesParserPage />);

    const onsiteCsv = `Client Name,Example,,
https://example.com/products/bedside-table/,,,
,,Num,Limit
Title,Bedside Table SEO Title,60,58
Keywords,bedside table,,
H1 Tag,Bedside Table H1,18,55
Meta Description,Bedside table SEO description,26,155
,,,
https://example.com/blogs/news/summer-sale/,,,
,,Num,Limit
Title,Summer Sale SEO Title,60,58
Keywords,summer sale,,
H1 Tag,Summer Sale H1,18,55
Meta Description,Summer sale SEO description,26,155`;

    const onsiteFile = attachText(
      new File([onsiteCsv], 'onsites.csv', { type: 'text/csv' }),
      onsiteCsv
    );

    const onsiteInput = screen.getByLabelText(/Onsites CSV/i) as HTMLInputElement;
    fireEvent.change(onsiteInput, { target: { files: [onsiteFile] } });

    const submitButton = screen.getByRole('button', { name: /Parse & Download/i });
    const form = submitButton.closest('form');
    if (!form) throw new Error('Expected form element');
    fireEvent.submit(form);

    expect(
      await screen.findByText(
        /Downloaded 2 file\(s\)\. 1 product URLs landed in the Shopify export and 1 URLs were excluded\./i
      )
    ).toBeInTheDocument();
    expect(await screen.findByText(/onsites_shopify\.csv/i)).toBeInTheDocument();
    expect(await screen.findByText(/onsites_shopify_excluded\.csv/i)).toBeInTheDocument();

    const exportedCard = screen.getByText(/^Exported$/i).closest('div');
    const excludedCard = screen.getByText(/^Excluded$/i).closest('div');
    const nonProductCard = screen.getByText(/^Non-Product$/i).closest('div');
    if (!exportedCard || !excludedCard || !nonProductCard) {
      throw new Error('Expected summary cards');
    }

    expect(within(exportedCard.parentElement ?? exportedCard).getByText(/^1$/)).toBeInTheDocument();
    expect(within(excludedCard.parentElement ?? excludedCard).getByText(/^1$/)).toBeInTheDocument();
    expect(within(nonProductCard.parentElement ?? nonProductCard).getByText(/^1$/)).toBeInTheDocument();
  });
});
