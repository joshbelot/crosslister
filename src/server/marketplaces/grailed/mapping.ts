import type { Condition } from '../../../shared/constants';
import { departmentOf, lookupByCategory } from '../../../shared/taxonomy';
import type { CategoryPath } from '../common';

export const GRAILED_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New/Never Worn', 'New'], new_without_tags: ['New/Never Worn', 'New'], like_new: ['Gently Used'],
  good: ['Used'], fair: ['Very Worn'], poor: ['Very Worn'],
};
export const GRAILED_CONDITION_LABELS = ['New/Never Worn', 'Gently Used', 'Used', 'Very Worn'];

export const GRAILED_CATEGORY_OVERRIDES: Record<string, CategoryPath> = {
  'men.tops.t_shirts': ['Menswear', 'Tops', 'Short Sleeve T-Shirts'],
  'men.tops.shirts': ['Menswear', 'Tops', ['Shirts (Button Ups)', 'Button Ups']],
  'men.tops.polos': ['Menswear', 'Tops', 'Polos'],
  'men.tops.sweaters': ['Menswear', 'Tops', 'Sweaters & Knitwear'],
  'men.tops.sweatshirts_hoodies': ['Menswear', 'Tops', 'Sweatshirts & Hoodies'],
  'men.bottoms.jeans': ['Menswear', 'Bottoms', 'Denim'],
  'men.bottoms.pants': ['Menswear', 'Bottoms', 'Casual Pants'],
  'men.bottoms.shorts': ['Menswear', 'Bottoms', 'Shorts'],
  'men.outerwear.jackets': ['Menswear', 'Outerwear', 'Light Jackets'],
  'men.outerwear.coats': ['Menswear', 'Outerwear', 'Heavy Coats'],
  'men.outerwear.vests': ['Menswear', 'Outerwear', 'Vests'],
  'men.suits_blazers': ['Menswear', 'Tailoring', ['Suits', 'Blazers']],
  'men.activewear': ['Menswear', 'Bottoms', 'Sweatpants & Joggers'],
  'men.swimwear': ['Menswear', 'Bottoms', 'Swimwear'],
  'men.shoes.sneakers': ['Menswear', 'Footwear', ['Low-Top Sneakers', 'Hi-Top Sneakers']],
  'men.shoes.boots': ['Menswear', 'Footwear', 'Boots'],
  'men.shoes.dress_shoes': ['Menswear', 'Footwear', ['Formal Shoes', 'Casual Leather Shoes']],
  'men.shoes.sandals': ['Menswear', 'Footwear', 'Sandals'],
  'men.bags': ['Menswear', 'Accessories', 'Bags & Luggage'],
  'men.accessories.hats': ['Menswear', 'Accessories', 'Hats'],
  'men.accessories.belts': ['Menswear', 'Accessories', 'Belts'],
  'men.accessories.sunglasses': ['Menswear', 'Accessories', 'Sunglasses'],
  'men.accessories.watches': ['Menswear', 'Accessories', 'Jewelry & Watches'],
  'men.accessories.ties': ['Menswear', 'Accessories', 'Ties & Pocketsquares'],
  'men.jewelry': ['Menswear', 'Accessories', 'Jewelry & Watches'],
  'women.tops': ['Womenswear', 'Tops'],
  'women.bottoms': ['Womenswear', 'Bottoms'],
  'women.dresses': ['Womenswear', 'Dresses'],
  'women.outerwear': ['Womenswear', 'Outerwear'],
  'women.shoes': ['Womenswear', 'Footwear'],
  'women.bags': ['Womenswear', ['Bags & Luggage', 'Accessories']],
  'women.accessories': ['Womenswear', 'Accessories'],
  'women.jewelry': ['Womenswear', 'Jewelry'],
  // Department-level fallbacks for leaves the table above doesn't cover (the user picks the rest).
  men: ['Menswear'],
  women: ['Womenswear'],
};

export const GRAILED_DEPARTMENTS = ['men', 'women'];

export function grailedCategoryPath(categoryId: string): CategoryPath | null {
  if (!GRAILED_DEPARTMENTS.includes(departmentOf(categoryId))) return null;
  return lookupByCategory(GRAILED_CATEGORY_OVERRIDES, categoryId) ?? null;
}

/** Women's paths stop at the category level; the user chooses the subcategory. */
export const grailedNeedsSubcategory = (categoryId: string | null): boolean =>
  categoryId !== null && departmentOf(categoryId) === 'women';

export const GRAILED_LISTING_REGEX = /\/listings\/(\d+)/;
export const GRAILED_HOSTS = ['grailed.com'];
export const grailedListingUrl = (id: string) => `https://www.grailed.com/listings/${id}`;
