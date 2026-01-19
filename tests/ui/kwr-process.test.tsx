// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import KwrProcessPage from '@/app/kwr-process/page';

describe('kwr process page', () => {
  it('skips URL validation when checkbox is enabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<KwrProcessPage />);

    fireEvent.change(screen.getByLabelText(/Client name/i), {
      target: { value: 'Acme' }
    });
    fireEvent.change(screen.getByLabelText(/Client URL/i), {
      target: { value: 'https://example.com' }
    });
    fireEvent.change(screen.getByLabelText(/Target market/i), {
      target: { value: 'USA' }
    });
    fireEvent.change(screen.getByLabelText(/List of URLs for keyword research/i), {
      target: { value: 'https://example.com/page-1\nhttps://example.com/page-2' }
    });

    fireEvent.click(screen.getByLabelText(/Don't check URLs status/i));
    fireEvent.click(screen.getByRole('button', { name: /Validate & Generate/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: /Ahrefs Keyword Extraction/i })
    ).toBeInTheDocument();
  });
});
