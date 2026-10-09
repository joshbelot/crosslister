import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFromHtml, mapAvailability, mergeExtracted } from '../../src/server/browser/extract';

const html = (n: string) => fs.readFileSync(path.join(__dirname, '../../fixtures/marketplace-pages/_import', n), 'utf8');

describe('extractFromHtml', () => {
  it('reads a JSON-LD Product with an offers array, ignoring broken blocks', () => {
    const x = extractFromHtml(html('product-jsonld.html'), 'https://shop.example.com/item/1');
    expect(x).toMatchObject({
      title: "Vintage Levi's trucker jacket", description: 'Soft and worn in.', brand: "Levi's", color: 'Blue', size: 'M',
      priceCents: 4850, currency: 'USD', availability: 'active', condition: 'Used', category: ['Men', 'Coats & Jackets'],
    });
  });
  it('unions images in order, de-duplicating by URL without query and resolving relative URLs', () => {
    const x = extractFromHtml(html('product-jsonld.html'), 'https://shop.example.com/item/1');
    expect(x.images).toEqual([
      'https://img.example.com/1.jpg?w=800', 'https://shop.example.com/2.jpg', 'https://img.example.com/3.jpg', 'https://img.example.com/4.jpg',
    ]);
  });
  it('finds a Product inside @graph with an array @type', () => {
    const x = extractFromHtml(html('product-graph.html'));
    expect(x).toMatchObject({ title: 'Graph item', priceCents: 1200, availability: 'sold', condition: 'New' });
  });
  it('falls back to OpenGraph / product meta tags', () => {
    const x = extractFromHtml(html('product-og.html'));
    expect(x).toMatchObject({ title: 'OG only jacket', description: 'Described', priceCents: 120000, brand: 'Gucci', condition: 'Used', availability: 'sold' });
    expect(x.images).toHaveLength(2);
  });
  it('returns nothing useful for an empty page', () => {
    expect(extractFromHtml('<html></html>')).toEqual({ images: [] });
  });
});

describe('availability and merging', () => {
  it('maps availability values', () => {
    expect(mapAvailability('https://schema.org/InStock')).toBe('active');
    expect(mapAvailability('in stock')).toBe('active');
    expect(mapAvailability('OutOfStock')).toBe('sold');
    expect(mapAvailability('SoldOut')).toBe('sold');
    expect(mapAvailability('Discontinued')).toBe('ended');
    expect(mapAvailability(undefined)).toBeUndefined();
  });
  it('earlier sources win per field', () => {
    const m = mergeExtracted({ title: 'A', images: ['x.jpg?1'] }, { title: 'B', brand: 'Z', images: ['x.jpg?2', 'y.jpg'] });
    expect(m).toEqual({ title: 'A', brand: 'Z', images: ['x.jpg?1', 'y.jpg'] });
  });
});
