import type { ColorId } from '../../../shared/colors';
import type { Condition } from '../../../shared/constants';
import { buildCategoryPath, type CategoryPath } from '../common';

export const DEPOP_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['Brand new'], new_without_tags: ['Brand new', 'Like new'], like_new: ['Like new'],
  good: ['Used - Excellent', 'Excellent'], fair: ['Used - Good', 'Good'], poor: ['Used - Fair', 'Fair'],
};
export const DEPOP_CONDITION_LABELS = ['Brand new', 'Like new', 'Used - Excellent', 'Used - Good', 'Used - Fair'];

export const DEPOP_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Grey', 'Gray'], brown: ['Brown'], tan: ['Tan'], beige: ['Cream', 'Tan'], cream: ['Cream'],
  red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'], blue: ['Blue'], navy: ['Navy'],
  purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: ['Multi'],
};

export const DEPOP_CATEGORY_SYNONYMS: Record<string, string[]> = {
  women: ['Womenswear', 'Women'], men: ['Menswear', 'Men'], kids: ['Kidswear', 'Kids'],
  'women.shoes': ['Footwear', 'Shoes'], 'men.shoes': ['Footwear', 'Shoes'],
  'women.shoes.sneakers': ['Trainers', 'Sneakers'], 'men.shoes.sneakers': ['Trainers', 'Sneakers'],
  'women.tops.t_shirts': ['T-shirts'], 'men.tops.t_shirts': ['T-shirts'],
  'women.tops.sweatshirts_hoodies': ['Hoodies', 'Sweatshirts'], 'men.tops.sweatshirts_hoodies': ['Hoodies', 'Sweatshirts'],
  'women.outerwear': ['Coats & jackets', 'Outerwear'], 'men.outerwear': ['Coats & jackets', 'Outerwear'],
  'women.accessories': ['Accessories'], 'men.accessories': ['Accessories'],
  home: ['Home', 'Everything else'], electronics: ['Electronics', 'Everything else'], collectibles: ['Everything else'], other: ['Everything else'],
};
export const DEPOP_CATEGORY_SKIP: string[] = [];

export function depopCategoryPath(categoryId: string): CategoryPath | null {
  return buildCategoryPath(categoryId, { synonyms: DEPOP_CATEGORY_SYNONYMS, skip: DEPOP_CATEGORY_SKIP });
}

/** Parcel size tiers by package weight (verify): ≤4 oz XS, ≤8 S, ≤16 M, ≤48 L, else XL. */
export function depopParcelSize(weightOz: number | null): string[] | null {
  if (weightOz === null) return null;
  if (weightOz <= 4) return ['Extra small', 'XS'];
  if (weightOz <= 8) return ['Small'];
  if (weightOz <= 16) return ['Medium'];
  if (weightOz <= 48) return ['Large'];
  return ['Extra large', 'XL'];
}

/** "#vintage #levis" — explicit hashtags, else the first 5 listing tags stripped to letters/digits. */
export function depopHashtagLine(hashtags: string[], tags: string[]): string {
  const source = hashtags.length ? hashtags : tags.map((t) => t.replace(/[^a-z0-9]/gi, '')).filter(Boolean).slice(0, 5);
  return source.map((h) => `#${h.toLowerCase()}`).join(' ');
}

export const DEPOP_LISTING_REGEX = /\/products\/(?!create\/|edit\/)([a-z0-9][a-z0-9-]+)\/?$/i;
export const DEPOP_HOSTS = ['depop.com'];
export const depopListingUrl = (slug: string) => `https://www.depop.com/products/${slug}/`;
