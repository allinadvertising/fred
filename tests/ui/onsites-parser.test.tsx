// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OnsitesParserPlatformPage from '@/app/onsites-parser/page';

describe('onsites parser platform page', () => {
  it('offers WordPress and Shopify parser choices', () => {
    render(<OnsitesParserPlatformPage />);

    expect(
      screen.getByRole('heading', { name: /Choose the destination platform/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WordPress/i })).toHaveAttribute(
      'href',
      '/onsites-parser/wordpress'
    );
    expect(screen.getByRole('link', { name: /Shopify/i })).toHaveAttribute(
      'href',
      '/onsites-parser/shopify'
    );
  });
});
