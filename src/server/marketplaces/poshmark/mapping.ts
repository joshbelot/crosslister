import type { ColorId } from '../../../shared/colors';
import type { Condition } from '../../../shared/constants';
import { departmentOf } from '../../../shared/taxonomy';
import { buildCategoryPath, type CategoryPath } from '../common';

export const POSHMARK_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New With Tags', 'NWT'], new_without_tags: ['New Without Tags', 'Like New'], like_new: ['Like New'],
  good: ['Good'], fair: ['Fair'], poor: ['Poor', 'Fair'],
};
export const POSHMARK_CONDITION_LABELS = ['New With Tags', 'New Without Tags', 'Like New', 'Good', 'Fair', 'Poor'];

export const POSHMARK_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Gray'], brown: ['Brown'], tan: ['Tan'], beige: ['Tan', 'Cream'], cream: ['Cream'],
  red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'], blue: ['Blue'], navy: ['Blue'],
  purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: [],
};

export const POSHMARK_CATEGORY_SKIP = ['women.bottoms', 'men.bottoms', 'women.tops', 'men.tops'];
export const POSHMARK_CATEGORY_OVERRIDES: Record<string, CategoryPath> = {
  'women.tops.t_shirts': ['Women', 'Tops', ['Tees - Short Sleeve', 'Tees']],
  'women.tops.blouses': ['Women', 'Tops', ['Blouses', 'Button Down Shirts']],
  'women.tops.tank_tops': ['Women', 'Tops', ['Tank Tops', 'Camisoles']],
  'women.tops.sweaters': ['Women', 'Sweaters'],
  'women.tops.sweatshirts_hoodies': ['Women', 'Tops', ['Sweatshirts & Hoodies']],
  'women.bottoms.jeans': ['Women', 'Jeans'],
  'women.bottoms.pants': ['Women', ['Pants & Jumpsuits', 'Pants']],
  'women.bottoms.leggings': ['Women', ['Pants & Jumpsuits', 'Pants'], 'Leggings'],
  'women.outerwear': ['Women', 'Jackets & Coats'],
  'women.activewear': ['Women', 'Tops', 'Athletic'], // verify
  'women.swimwear': ['Women', 'Swim'],
  'women.bags': ['Women', 'Bags'],
  'women.accessories': ['Women', 'Accessories'],
  'men.tops.t_shirts': ['Men', 'Shirts', ['Tees - Short Sleeve', 'Tees']],
  'men.tops.shirts': ['Men', 'Shirts', ['Casual Button Down Shirts', 'Button Down']],
  'men.tops.polos': ['Men', 'Shirts', 'Polos'],
  'men.tops.sweaters': ['Men', 'Sweaters'],
  'men.tops.sweatshirts_hoodies': ['Men', 'Shirts', ['Sweatshirts & Hoodies']],
  'men.bottoms.jeans': ['Men', 'Jeans'],
  'men.bottoms.pants': ['Men', 'Pants'],
  'men.bottoms.shorts': ['Men', 'Shorts'],
  'men.outerwear': ['Men', 'Jackets & Coats'],
  'men.suits_blazers': ['Men', 'Suits & Blazers'],
  'men.swimwear': ['Men', 'Swim'],
  'men.bags': ['Men', 'Bags'],
  'men.accessories': ['Men', 'Accessories'],
  'kids.girls_clothing': ['Kids', ['Girls', 'Dresses']], 'kids.boys_clothing': ['Kids', ['Boys', 'Shirts & Tops']],
  'kids.shoes': ['Kids', 'Shoes'], 'kids.toys': ['Kids', 'Toys'],
  home: ['Home'], electronics: ['Electronics'],
};
export const POSHMARK_CATEGORY_SYNONYMS: Record<string, string[]> = {
  'women.shoes.flats': ['Flats & Loafers'], 'women.shoes.boots': ['Ankle Boots & Booties', 'Boots'],
  'men.shoes.dress_shoes': ['Loafers & Slip-Ons', 'Oxfords & Derbys'], 'women.outerwear.jackets': ['Jackets'],
};

export const POSHMARK_UNSUPPORTED_DEPARTMENTS = ['collectibles', 'other'];

export function poshmarkCategoryPath(categoryId: string): CategoryPath | null {
  if (POSHMARK_UNSUPPORTED_DEPARTMENTS.includes(departmentOf(categoryId))) return null;
  return buildCategoryPath(categoryId, { synonyms: POSHMARK_CATEGORY_SYNONYMS, overrides: POSHMARK_CATEGORY_OVERRIDES, skip: POSHMARK_CATEGORY_SKIP });
}

/** Poshmark lists whole-dollar prices. */
export const poshmarkWholeDollars = (cents: number) => Math.round(cents / 100);

export const POSHMARK_LISTING_REGEX = /\/listing\/(?:[^/]*-)?([a-f0-9]{24})\/?$/;
export const POSHMARK_HOSTS = ['poshmark.com'];
export const poshmarkListingUrl = (id: string) => `https://poshmark.com/listing/${id}`;
