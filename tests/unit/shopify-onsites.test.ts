import { describe, expect, it } from 'vitest';
import { buildShopifyOnsitesOutput } from '@/lib/shopify-onsites';

describe('shopify onsite helpers', () => {
  it('exports only product urls and sends non-product urls to an exclusion csv by default', () => {
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

    const result = buildShopifyOnsitesOutput({
      onsitesCsv: onsiteCsv,
      onsiteFileName: 'KWR April 2026.csv'
    });

    expect(result.summary).toEqual({
      total: 2,
      exported: 1,
      excluded: 1,
      nonProduct: 1
    });
    expect(result.rows).toEqual([
      {
        Handle: 'bedside-table',
        'SEO Title': 'Bedside Table SEO Title',
        'SEO Description': 'Bedside table SEO description'
      }
    ]);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({
      kind: 'products',
      fileName: 'KWR_April_2026_shopify.csv',
      rowCount: 1
    });
    expect(result.files[0].csvText).toBe(
      'Handle,SEO Title,SEO Description\nbedside-table,Bedside Table SEO Title,Bedside table SEO description'
    );
    expect(result.files[1]).toMatchObject({
      kind: 'excluded',
      fileName: 'KWR_April_2026_shopify_excluded.csv',
      rowCount: 1
    });
    expect(result.files[1].csvText).toContain(
      'URL,Title,Keywords,H1 Tag,Meta Description,Match Status,Match Note'
    );
    expect(result.files[1].csvText).toContain('https://example.com/blogs/news/summer-sale/');
    expect(result.files[1].csvText).toContain('excluded_non_product');
  });

  it('includes Title only when the H1 bypass is disabled', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/products/bedside-table/,,,
,,Num,Limit
Title,Bedside Table SEO Title,60,58
Keywords,bedside table,,
H1 Tag,Bedside Table H1,18,55
Meta Description,Bedside table SEO description,26,155`;

    const result = buildShopifyOnsitesOutput({
      onsitesCsv: onsiteCsv,
      bypassH1Update: false
    });

    expect(result.summary.exported).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].csvText).toBe(
      'Handle,SEO Title,SEO Description,Title\nbedside-table,Bedside Table SEO Title,Bedside table SEO description,Bedside Table H1'
    );
  });
});
