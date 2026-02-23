// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MetadataCreationPage from '@/app/metadata-creation/page';

describe('metadata creation page', () => {
  beforeEach(() => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('requires brand name before submitting', async () => {
    render(<MetadataCreationPage />);

    const fileInput = screen.getByLabelText(/Keyword Mapping CSV/i) as HTMLInputElement;
    const file = new File(['URL,Keyword\nhttps://example.com,widgets\n'], 'kw.csv', {
      type: 'text/csv'
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const submitButton = screen.getByRole('button', { name: /generate/i });
    const form = submitButton.closest('form');
    if (!form) throw new Error('Expected form element');
    fireEvent.submit(form);

    expect(await screen.findByText(/Please enter the Brand\/Name/i)).toBeInTheDocument();
  });

  it('shows a checkbox to bypass the pipe-brand suffix', async () => {
    render(<MetadataCreationPage />);

    expect(
      await screen.findByRole('checkbox', { name: /Bypass .*Brand Name.*suffix/i })
    ).toBeInTheDocument();
  });
});
