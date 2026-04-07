// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnsitesParserPage from '@/app/onsites-parser/page';

const attachText = (file: File, text: string) => {
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(text)
  });
  return file;
};

const onsiteOnlyText = `Client Name,Example,,
https://example.com/about-us/,,,
,,Num,Limit
Title,About Us,,
Keywords,brand story,,
H1 Tag,About Us H1,,
Meta Description,About us description,,`;

const onsiteOnlyFile = attachText(
  new File([onsiteOnlyText], 'onsites.csv', { type: 'text/csv' }),
  onsiteOnlyText
);

describe('onsites parser page', () => {
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

  it('enables the H1 bypass checkbox by default', () => {
    render(<OnsitesParserPage />);

    expect(screen.getByRole('checkbox', { name: /Bypass H1 update/i })).toBeChecked();
  });

  it('requires at least one source export in addition to the onsite file', async () => {
    render(<OnsitesParserPage />);

    const onsiteInput = screen.getByLabelText(/Onsites CSV/i) as HTMLInputElement;
    fireEvent.change(onsiteInput, { target: { files: [onsiteOnlyFile] } });

    const submitButton = screen.getByRole('button', { name: /Parse & Download/i });
    const form = submitButton.closest('form');
    if (!form) throw new Error('Expected form element');
    fireEvent.submit(form);

    expect(
      await screen.findByText(/Upload at least one source CSV: Products, Posts, or Pages/i)
    ).toBeInTheDocument();
  });

  it('shows the high non-matched suggestion modal when 30% or more fail to match', async () => {
    render(<OnsitesParserPage />);

    const onsiteInput = screen.getByLabelText(/Onsites CSV/i) as HTMLInputElement;
    const productsInput = screen.getByLabelText(/Products CSV/i) as HTMLInputElement;

    const onsiteFile = new File(
      [
        `Client Name,Example,,
https://example.com/product/widget-product/,,,
,,Num,Limit
Title,Widget Product Title,60,58
Keywords,widget keyword,,
H1 Tag,Widget Product H1,18,55
Meta Description,Widget product description,26,155
,,,
https://example.com/blog/post-one/,,,
,,Num,Limit
Title,Post One Title,,
Keywords,post keyword,,
H1 Tag,Post One H1,,
Meta Description,Post one description,,`
      ],
      'onsites.csv',
      { type: 'text/csv' }
    );

    const productsFile = attachText(
      new File(
        [
          `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
Current Product H1,101,widget-product,Current Meta Title,Current Meta Description,current keyword`
        ],
        'products.csv',
        { type: 'text/csv' }
      ),
      `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
Current Product H1,101,widget-product,Current Meta Title,Current Meta Description,current keyword`
    );

    const onsiteWithMixedMatches = attachText(
      onsiteFile,
      `Client Name,Example,,
https://example.com/product/widget-product/,,,
,,Num,Limit
Title,Widget Product Title,60,58
Keywords,widget keyword,,
H1 Tag,Widget Product H1,18,55
Meta Description,Widget product description,26,155
,,,
https://example.com/blog/post-one/,,,
,,Num,Limit
Title,Post One Title,,
Keywords,post keyword,,
H1 Tag,Post One H1,,
Meta Description,Post one description,,`
    );

    fireEvent.change(onsiteInput, { target: { files: [onsiteWithMixedMatches] } });
    fireEvent.change(productsInput, { target: { files: [productsFile] } });

    const submitButton = screen.getByRole('button', { name: /Parse & Download/i });
    const form = submitButton.closest('form');
    if (!form) throw new Error('Expected form element');
    fireEvent.submit(form);

    expect(await screen.findByText(/High non-matched share/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Consider exporting and uploading the other source files/i)
    ).toBeInTheDocument();
    expect(await screen.findByText(/Posts, Pages/i)).toBeInTheDocument();
  });
});
