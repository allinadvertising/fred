import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { startNextServer } from '../utils/next-server';

describe('api/metadata', () => {
  let baseUrl = '';
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.META_TEST_MODE = 'true';
    const server = await startNextServer();
    baseUrl = server.url;
    closeServer = server.close;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  const requestTitle = async ({
    kwCsv,
    sfCsv,
    brand = 'Acme'
  }: {
    kwCsv: string;
    sfCsv: string;
    brand?: string;
  }) => {
    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand,
        gen_title: true,
        gen_desc: false,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    return rows[0]?.['New Title'] ?? '';
  };

  const requestDescription = async ({
    kwCsv,
    sfCsv,
    brand = 'Acme'
  }: {
    kwCsv: string;
    sfCsv: string;
    brand?: string;
  }) => {
    const response = await request(baseUrl)
      .post('/api/metadata/?format=csv')
      .set('Content-Type', 'application/json')
      .send({
        kw_csv: kwCsv,
        sf_csv: sfCsv,
        brand,
        gen_title: false,
        gen_desc: true,
        gen_h1: false,
        clamp_title: true,
        clamp_desc: true
      });

    expect(response.status).toBe(200);
    const rows = parse(response.text, { columns: true, skip_empty_lines: true }) as Array<
      Record<string, string>
    >;
    return rows[0]?.['New Description'] ?? '';
  };

  it('avoids a glued lowercase keyword+slug title when falling back to deterministic candidates', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/products/bio-cozyme-bio-stimulant,bio stimulant\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/products/bio-cozyme-bio-stimulant,[force-second-rewrite],Old Desc,\n'
    });

    expect(title.toLowerCase()).not.toContain('bio stimulant bio cozyme bio stimulant');
    expect(title.toLowerCase()).not.toMatch(/\band\s*(\||$)/);
  });

  it('repairs a description that stops mid-sentence instead of shipping a dangling fragment', async () => {
    const description = await requestDescription({
      kwCsv: 'URL,Keyword\nhttps://example.com/products/sea-grow,seaweed fertilizer\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/products/sea-grow,Old Title,"Enhance your plants with Grow More Sea Grow a balanced seaweed fertilizer blend featuring essential nutrients for robust growth. Perfect for all gardening",Sea Grow\n'
    });

    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.toLowerCase()).not.toMatch(/\b(to|for|and|with|of|in|on|at|from|by|after|before)\s*$/);
    expect(/[.!?]$/.test(description)).toBe(true);
  });

  it('keeps a complete keyword-focused title in the preferred 55 to 65 character range when the first draft already passes QA', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/blog/compressor-maintenance,Industrial Air Compressor Maintenance Checklist\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/blog/compressor-maintenance,Old Title,Old Desc,Food Plants\n'
    });

    expect(title).toContain('Industrial Air Compressor Maintenance Checklist');
    expect(title.length).toBeGreaterThanOrEqual(55);
    expect(title.length).toBeLessThanOrEqual(65);
  });

  it('allows a complete fallback title in the 66 to 70 character range when a required brand suffix preserves the full keyword phrase', async () => {
    const keyword = 'Industrial Air Compressor Checklist for Food Processing Plants';
    const title = await requestTitle({
      kwCsv: `URL,Keyword\nhttps://example.com/services/food-processing-plants,${keyword}\n`,
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/services/food-processing-plants,Old Title,Old Desc,\n'
    });

    expect(title).toContain(keyword);
    expect(title).toContain(' | Acme');
    expect(title.length).toBeGreaterThan(65);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('rejects a short thin draft and rewrites it with a page-specific differentiator before delivery', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/services/medical-clinics-surgery-centers,Emergency HVAC Repair\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/services/medical-clinics-surgery-centers,Old Title,Old Desc,Medical Clinics and\n'
    });

    expect(title).toContain('Emergency HVAC Repair');
    expect(title.length).toBeGreaterThanOrEqual(55);
    expect(title.length).toBeLessThanOrEqual(65);
    expect(title.toLowerCase()).not.toMatch(/\b(to|for|and|with|of|in|on|at|from|by|after|before)\s*$/);
  });

  it('keeps the final title closely aligned to the primary keyword after the rewrite pass', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/collections/ecommerce-subscription-brands,Custom Poly Mailers\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/collections/ecommerce-subscription-brands,Old Title,Old Desc,Ecommerce Brands in\n'
    });

    expect(title).toContain('Custom Poly Mailers');
    expect(title).not.toContain('Poly Mailers | Acme');
    expect(title.length).toBeGreaterThanOrEqual(55);
    expect(title.length).toBeLessThanOrEqual(65);
  });

  it('rewrites an incomplete ending instead of delivering a mechanically clipped final phrase', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/blog/after-storm-damage,Commercial Roof Repair for Houston Warehouses\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/blog/after-storm-damage,Old Title,Old Desc,After\n'
    });

    expect(title).toContain('Commercial Roof Repair for Houston Warehouses');
    expect(title).toContain('After Storm Damage');
    expect(title.length).toBeGreaterThanOrEqual(55);
    expect(title.length).toBeLessThanOrEqual(65);
    expect(title.toLowerCase()).not.toMatch(/\bafter\s*$/);
  });

  it('reruns validation after a failed editorial rewrite and accepts a later rewrite only after it passes QA', async () => {
    const title = await requestTitle({
      kwCsv:
        'URL,Keyword\nhttps://example.com/services/medical-clinics-surgery-centers,Emergency HVAC Repair\n',
      sfCsv:
        'Address,Title 1,Meta Description 1,H1-1\nhttps://example.com/services/medical-clinics-surgery-centers,[force-second-rewrite],Old Desc,Medical Clinics and\n'
    });

    expect(title).not.toBe('Emergency HVAC Repair and');
    expect(title).toContain('Emergency HVAC Repair');
    expect(title.length).toBeGreaterThanOrEqual(55);
    expect(title.length).toBeLessThanOrEqual(65);
    expect(title.toLowerCase()).not.toMatch(/\band\s*$/);
  });
});
