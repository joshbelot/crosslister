import type { Condition } from '../../../shared/constants';
import { lookupByCategory } from '../../../shared/taxonomy';

export const FACEBOOK_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New'], new_without_tags: ['New'], like_new: ['Used - Like New', 'Like New'],
  good: ['Used - Good', 'Good'], fair: ['Used - Fair', 'Fair'], poor: ['Used - Fair', 'Fair'],
};
export const FACEBOOK_CONDITION_LABELS = ['New', 'Used - Like New', 'Used - Good', 'Used - Fair'];

/** Facebook category = search terms typed into the category combobox (first match wins). */
export const FACEBOOK_CATEGORY_TERMS: Record<string, string[]> = {
  'men.shoes': ["Men's Shoes", 'Shoes'], 'women.shoes': ["Women's Shoes", 'Shoes'], 'kids.shoes': ["Kids' Shoes", 'Shoes'],
  men: ["Men's Clothing", 'Clothing'], women: ["Women's Clothing", 'Clothing'],
  'men.bags': ['Bags & Luggage'], 'women.bags': ['Handbags', 'Bags & Luggage'],
  'men.jewelry': ['Jewelry & Watches', 'Jewelry'], 'women.jewelry': ['Jewelry & Watches', 'Jewelry'],
  'men.accessories.watches': ['Watches', 'Jewelry & Watches'],
  'kids.girls_clothing': ["Kids' Clothing", 'Baby & Kids'], 'kids.boys_clothing': ["Kids' Clothing", 'Baby & Kids'],
  'kids.baby_clothing': ['Baby Clothing', 'Baby & Kids'], 'kids.toys': ['Toys & Games'],
  'home.decor': ['Home Decor'], 'home.kitchen_dining': ['Kitchen & Dining', 'Household'], 'home.bedding_bath': ['Bedding', 'Household'],
  'electronics.phones': ['Cell Phones'], 'electronics.computers_tablets': ['Computers', 'Electronics & Computers'],
  'electronics.video_games': ['Video Games'], 'electronics.audio': ['Audio', 'Electronics & Computers'], 'electronics.cameras': ['Cameras'],
  'collectibles.trading_cards': ['Trading Cards', 'Collectibles'], 'collectibles.vinyl_records': ['Vinyl Records', 'Music'],
  'collectibles.books': ['Books'], 'collectibles.toys_figures': ['Action Figures', 'Toys & Games'],
  other: ['Miscellaneous'],
};

export function facebookCategoryTerms(categoryId: string): string[] | null {
  return lookupByCategory(FACEBOOK_CATEGORY_TERMS, categoryId) ?? null;
}

/** The last `A > B > C` segment, used as a single search term for user-provided paths. */
export function termFromPath(path: string): string | null {
  const last = path.split('>').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? null;
}

export const FACEBOOK_LISTING_REGEX = /\/marketplace\/item\/(\d+)/;
export const FACEBOOK_HOSTS = ['facebook.com'];
export const facebookListingUrl = (id: string) => `https://www.facebook.com/marketplace/item/${id}/`;
