import type { ColorId } from '../../../shared/colors';
import type { Condition } from '../../../shared/constants';
import { buildCategoryPath, type CategoryPath } from '../common';

export const MERCARI_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New'], new_without_tags: ['Like new'], like_new: ['Like new'],
  good: ['Good'], fair: ['Fair'], poor: ['Poor'],
};
export const MERCARI_CONDITION_LABELS = ['New', 'Like new', 'Good', 'Fair', 'Poor'];

export const MERCARI_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Gray'], brown: ['Brown'], tan: ['Beige', 'Brown'], beige: ['Beige'],
  cream: ['Beige', 'White'], red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'],
  blue: ['Blue'], navy: ['Blue'], purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: [],
};

export const MERCARI_CATEGORY_SYNONYMS: Record<string, string[]> = {
  'women.tops': ['Tops & blouses', 'Tops'], 'men.tops': ['Tops', 'Shirts'],
  'women.outerwear': ['Coats & jackets', 'Jackets & coats'], 'men.outerwear': ['Coats & jackets', 'Jackets & coats'],
  'women.tops.t_shirts': ['T-shirts', 'Tees'], 'men.tops.t_shirts': ['T-shirts', 'Tees'],
  'men.tops.shirts': ['Button-front', 'Casual button-down shirts', 'Button down'],
  'women.tops.sweaters': ['Sweaters'], 'men.tops.sweaters': ['Sweaters'],
  'women.tops.sweatshirts_hoodies': ['Sweatshirts & hoodies', 'Hoodies'], 'men.tops.sweatshirts_hoodies': ['Sweatshirts & hoodies', 'Hoodies'],
  'women.shoes.sneakers': ['Sneakers', 'Athletic'], 'men.shoes.sneakers': ['Sneakers', 'Athletic'],
  'men.shoes.dress_shoes': ['Oxfords', 'Dress shoes', 'Loafers & slip-ons'],
  'women.bags': ['Bags', 'Handbags'], 'women.bags.handbags': ['Shoulder bags', 'Totes & shoppers', 'Handbags'],
  'women.jewelry': ['Jewelry'], 'men.jewelry': ['Jewelry'],
  'electronics.video_games': ['Video games & consoles'], 'electronics.phones': ['Cell phones & accessories', 'Cell phones & smartphones'],
  'collectibles': ['Vintage & collectibles', 'Toys & collectibles'], 'collectibles.trading_cards': ['Trading cards'],
  'kids': ['Kids'], 'home': ['Home'], 'other': ['Other'],
};
/** Mercari lists Jeans/Pants/Shorts directly under the department (verify). */
export const MERCARI_CATEGORY_SKIP = ['women.bottoms', 'men.bottoms'];
export const MERCARI_CATEGORY_OVERRIDES: Record<string, CategoryPath> = {
  'other.other': ['Other', 'Other'],
};

export function mercariCategoryPath(categoryId: string): CategoryPath | null {
  return buildCategoryPath(categoryId, { synonyms: MERCARI_CATEGORY_SYNONYMS, overrides: MERCARI_CATEGORY_OVERRIDES, skip: MERCARI_CATEGORY_SKIP });
}

/** 20 → { lb: 1, oz: 4 }; ounces are rounded up to a whole number. */
export function mercariShippingWeight(weightOz: number): { lb: number; oz: number } {
  const total = Math.max(0, Math.ceil(weightOz));
  return { lb: Math.floor(total / 16), oz: total % 16 };
}

export const MERCARI_LISTING_REGEX = /\/us\/item\/(m\d{6,})/;
export const MERCARI_HOSTS = ['mercari.com'];
export const mercariListingUrl = (id: string) => `https://www.mercari.com/us/item/${id}/`;
