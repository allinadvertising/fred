import { describe, expect, it } from 'vitest';
import { buildOnsitesParserOutput, parseOnsitesCsv } from '@/lib/onsites';

describe('onsites parser helpers', () => {
  it('parses the non-standard onsite CSV blocks', () => {
    const onsiteCsv = `Client Name,Example,,
Client Website,,,
https://example.com/product/widget-product/,,,
,,Num,Limit
Title,Widget Product Title,60,58
Keywords,widget keyword,,
H1 Tag,Widget Product H1,18,55
Meta Description,Widget product description,26,155
,,,
https://example.com/about-us/,,,
,,Num,Limit
Title,About Us Title,,
Keywords,brand story,,
H1 Tag,About Us H1,,
Meta Description,About us description,,`;

    expect(parseOnsitesCsv(onsiteCsv)).toEqual([
      {
        url: 'https://example.com/product/widget-product/',
        title: 'Widget Product Title',
        keyword: 'widget keyword',
        h1: 'Widget Product H1',
        metaDescription: 'Widget product description'
      },
      {
        url: 'https://example.com/about-us/',
        title: 'About Us Title',
        keyword: 'brand story',
        h1: 'About Us H1',
        metaDescription: 'About us description'
      }
    ]);
  });

  it('builds source-specific matched exports with onsite-only values', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/product/widget-product/,,,
,,Num,Limit
Title,Widget Product Title,60,58
Keywords,widget keyword,,
H1 Tag,Widget Product H1,18,55
Meta Description,Widget product description,26,155`;

    const productsCsv = `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
Current Product H1,101,widget-product,Current Meta Title,Current Meta Description,current keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productsCsv,
      bypassH1Update: true,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.summary).toEqual({
      total: 1,
      matched: 1,
      nonMatched: 0,
      unmatched: 0,
      ambiguous: 0,
      matchedBySource: {
        products: 1,
        productCategories: 0,
        posts: 0,
        pages: 0
      },
      nonMatchedRate: 0,
      suggestionNeeded: false,
      suggestedSources: ['productCategories', 'posts', 'pages']
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      kind: 'matched',
      sourceType: 'products',
      fileName: 'onsites_products_matched.csv',
      rowCount: 1
    });
    expect(result.files[0].csvText).toBe(
      'ID,post_name,aioseo_title,aioseo_description,keyphrases\n101,widget-product,Widget Product Title,Widget product description,widget keyword'
    );
  });

  it('matches nested /store/products urls to product exports by slug', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/store/products/adult-changing-tables/ct-5000-change-table-fixed-height-pressalit/,,,
,,Num,Limit
Title,CT 5000 Product Title,60,58
Keywords,adult changing table,,
H1 Tag,CT 5000 Product H1,18,55
Meta Description,CT 5000 product description,26,155`;

    const productsCsv = `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
Current Product H1,501,ct-5000-change-table-fixed-height-pressalit,Current Meta Title,Current Meta Description,current keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productsCsv,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.summary).toMatchObject({
      matched: 1,
      nonMatched: 0,
      matchedBySource: {
        products: 1,
        productCategories: 0,
        posts: 0,
        pages: 0
      }
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      kind: 'matched',
      sourceType: 'products',
      fileName: 'onsites_products_matched.csv',
      rowCount: 1
    });
    expect(result.files[0].csvText).toBe(
      'ID,post_name,aioseo_title,aioseo_description,keyphrases\n501,ct-5000-change-table-fixed-height-pressalit,CT 5000 Product Title,CT 5000 product description,adult changing table'
    );
  });

  it('maps Yoast-style headers when those fields are present', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/blog/widget-guide/,,,
,,Num,Limit
Title,Widget Guide Title,60,58
Keywords,widget guide keyword,,
H1 Tag,Widget Guide H1,18,55
Meta Description,Widget guide description,26,155`;

    const postsCsv = `post_title,ID,post_name,seo_title,meta_desc,focus_keyword
Current Post H1,202,widget-guide,Current Yoast Title,Current Yoast Description,current yoast keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      postsCsv,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].csvText).toBe(
      'ID,post_name,seo_title,meta_desc,focus_keyword\n202,widget-guide,Widget Guide Title,Widget guide description,widget guide keyword'
    );
  });

  it('maps Rank Math style headers when those fields are present', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/product/widget-product/,,,
,,Num,Limit
Title,Widget Product Title,60,58
Keywords,widget keyword,,
H1 Tag,Widget Product H1,18,55
Meta Description,Widget product description,26,155`;

    const productsCsv = `post_title,ID,post_name,rank_math_title,rank_math_description,rank_math_focus_keyword
Current Product H1,101,widget-product,Current Rank Title,Current Rank Description,current rank keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productsCsv,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].csvText).toBe(
      'ID,post_name,rank_math_title,rank_math_description,rank_math_focus_keyword\n101,widget-product,Widget Product Title,Widget product description,widget keyword'
    );
  });

  it('builds product category matched exports from taxonomy-style source rows', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/product-category/clothing/tshirts/,,,
,,Num,Limit
Title,T-Shirts Category Title,60,58
Keywords,tshirts keyword,,
H1 Tag,T-Shirts Category H1,18,55
Meta Description,T-Shirts category description,26,155`;

    const productCategoriesCsv = `name,slug,description,parent,TERMID,seo_title,meta_desc,focus_keyword
Clothing,clothing,,,16,Current Clothing Title,Current Clothing Description,current clothing keyword
Clothing>Tshirts,tshirts,,Clothing,17,Current Category Title,Current Category Description,current category keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productCategoriesCsv,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.summary.matchedBySource).toEqual({
      products: 0,
      productCategories: 1,
      posts: 0,
      pages: 0
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      kind: 'matched',
      sourceType: 'productCategories',
      fileName: 'onsites_product_categories_matched.csv',
      rowCount: 1
    });
    expect(result.files[0].csvText).toBe(
      'name,slug,parent,TERMID,seo_title,meta_desc,focus_keyword\nClothing>Tshirts,tshirts,Clothing,17,T-Shirts Category Title,T-Shirts category description,tshirts keyword'
    );
  });

  it('creates a non-matched file and suggests missing sources when 30% or more do not match', () => {
    const onsiteCsv = `Client Name,Example,,
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
Meta Description,Post one description,,`;

    const productsCsv = `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
Current Product H1,101,widget-product,Current Meta Title,Current Meta Description,current keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productsCsv,
      bypassH1Update: false,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.summary.nonMatched).toBe(1);
    expect(result.summary.nonMatchedRate).toBe(0.5);
    expect(result.summary.suggestionNeeded).toBe(true);
    expect(result.summary.suggestedSources).toEqual(['productCategories', 'posts', 'pages']);

    expect(result.files).toHaveLength(2);
    expect(result.files[0].csvText).toBe(
      'ID,post_name,post_title,aioseo_title,aioseo_description,keyphrases\n101,widget-product,Widget Product H1,Widget Product Title,Widget product description,widget keyword'
    );
    expect(result.files[1]).toMatchObject({
      kind: 'non_matched',
      fileName: 'onsites_non_matched.csv',
      rowCount: 1
    });
    expect(result.files[1].csvText).toContain(
      'URL,Title,Keywords,H1 Tag,Meta Description,Match Status,Matched By,Match Note'
    );
    expect(result.files[1].csvText).toContain('https://example.com/blog/post-one/');
    expect(result.files[1].csvText).toContain('Posts export was not uploaded');
  });

  it('labels /store/products urls as products when the Products export is missing', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/store/products/adult-changing-tables/ct-5000-change-table-fixed-height-pressalit/,,,
,,Num,Limit
Title,CT 5000 Product Title,60,58
Keywords,adult changing table,,
H1 Tag,CT 5000 Product H1,18,55
Meta Description,CT 5000 product description,26,155`;

    const pagesCsv = `post_title,ID,post_name,aioseo_title,aioseo_description,keyphrases
About Us,301,about-us,Current Page Title,Current Page Description,current page keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      pagesCsv,
      onsiteFileName: 'onsites.csv'
    });

    expect(result.summary.nonMatched).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].kind).toBe('non_matched');
    expect(result.files[0].csvText).toContain(
      'URL looks like a product URL, but the Products export was not uploaded.'
    );
  });

  it('does not slug-match deep category archive URLs unless an exact candidate exists', () => {
    const onsiteCsv = `Client Name,Example,,
https://example.com/product-category/barrels/9mm/,,,
,,Num,Limit
Title,Category Title,,
Keywords,category keyword,,
H1 Tag,Category H1,,
Meta Description,Category description,,`;

    const productCategoriesCsv = `name,slug,parent,TERMID,seo_title,meta_desc,focus_keyword
9mm,9mm,,17,Current Category Title,Current Category Description,current category keyword`;

    const result = buildOnsitesParserOutput({
      onsitesCsv: onsiteCsv,
      productCategoriesCsv
    });

    expect(result.summary.nonMatched).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].kind).toBe('non_matched');
    expect(result.files[0].csvText).toContain('unmatched');
    expect(result.files[0].csvText).toContain(
      'A similar slug exists, but this deeper URL needs an exact URL or path match.'
    );
  });
});
