export type SizeType =
  | 'letter' | 'womens_numeric' | 'waist' | 'shoe_men' | 'shoe_women' | 'kids' | 'one_size' | 'none';

export interface CategoryNode {
  id: string;
  label: string;           // label of this node only, e.g. "Sneakers"
  parentId: string | null;
  selectable: boolean;     // leaves are selectable; departments/groups are not
  sizeType?: SizeType;     // inherited by children when absent
}

type Def = [id: string, label: string, sizeType?: SizeType];

// Departments
const DEPARTMENTS: Def[] = [
  ['women', 'Women'], ['men', 'Men'], ['kids', 'Kids'], ['home', 'Home'],
  ['electronics', 'Electronics'], ['collectibles', 'Collectibles & Media'], ['other', 'Other'],
];

// Groups (not selectable) — children listed in LEAVES
const GROUPS: Def[] = [
  ['women.tops', 'Tops', 'letter'], ['women.bottoms', 'Bottoms', 'letter'], ['women.outerwear', 'Outerwear', 'letter'],
  ['women.shoes', 'Shoes', 'shoe_women'], ['women.bags', 'Bags', 'one_size'], ['women.accessories', 'Accessories', 'one_size'],
  ['men.tops', 'Tops', 'letter'], ['men.bottoms', 'Bottoms', 'waist'], ['men.outerwear', 'Outerwear', 'letter'],
  ['men.shoes', 'Shoes', 'shoe_men'], ['men.accessories', 'Accessories', 'one_size'],
];

const LEAVES: Def[] = [
  // Women
  ['women.tops.t_shirts', 'T-Shirts'], ['women.tops.blouses', 'Blouses & Shirts'], ['women.tops.sweaters', 'Sweaters'],
  ['women.tops.sweatshirts_hoodies', 'Sweatshirts & Hoodies'], ['women.tops.tank_tops', 'Tank Tops & Camis'],
  ['women.bottoms.jeans', 'Jeans', 'waist'], ['women.bottoms.pants', 'Pants'], ['women.bottoms.shorts', 'Shorts'],
  ['women.bottoms.skirts', 'Skirts'], ['women.bottoms.leggings', 'Leggings'],
  ['women.dresses', 'Dresses', 'letter'],
  ['women.outerwear.jackets', 'Jackets'], ['women.outerwear.coats', 'Coats'], ['women.outerwear.vests', 'Vests'],
  ['women.activewear', 'Activewear', 'letter'], ['women.swimwear', 'Swimwear', 'letter'],
  ['women.shoes.sneakers', 'Sneakers'], ['women.shoes.boots', 'Boots'], ['women.shoes.heels', 'Heels'],
  ['women.shoes.flats', 'Flats & Loafers'], ['women.shoes.sandals', 'Sandals'],
  ['women.bags.handbags', 'Handbags'], ['women.bags.backpacks', 'Backpacks'], ['women.bags.wallets', 'Wallets'],
  ['women.accessories.hats', 'Hats'], ['women.accessories.scarves', 'Scarves'], ['women.accessories.belts', 'Belts'],
  ['women.accessories.sunglasses', 'Sunglasses'],
  ['women.jewelry', 'Jewelry', 'none'],
  // Men
  ['men.tops.t_shirts', 'T-Shirts'], ['men.tops.shirts', 'Button-Down Shirts'], ['men.tops.polos', 'Polos'],
  ['men.tops.sweaters', 'Sweaters'], ['men.tops.sweatshirts_hoodies', 'Sweatshirts & Hoodies'],
  ['men.bottoms.jeans', 'Jeans'], ['men.bottoms.pants', 'Pants'], ['men.bottoms.shorts', 'Shorts'],
  ['men.outerwear.jackets', 'Jackets'], ['men.outerwear.coats', 'Coats'], ['men.outerwear.vests', 'Vests'],
  ['men.suits_blazers', 'Suits & Blazers', 'letter'], ['men.activewear', 'Activewear', 'letter'],
  ['men.swimwear', 'Swimwear', 'letter'],
  ['men.shoes.sneakers', 'Sneakers'], ['men.shoes.boots', 'Boots'], ['men.shoes.dress_shoes', 'Dress Shoes'],
  ['men.shoes.sandals', 'Sandals'],
  ['men.bags', 'Bags', 'one_size'],
  ['men.accessories.hats', 'Hats'], ['men.accessories.belts', 'Belts'], ['men.accessories.sunglasses', 'Sunglasses'],
  ['men.accessories.watches', 'Watches'], ['men.accessories.ties', 'Ties'],
  ['men.jewelry', 'Jewelry', 'none'],
  // Kids
  ['kids.girls_clothing', 'Girls Clothing', 'kids'], ['kids.boys_clothing', 'Boys Clothing', 'kids'],
  ['kids.baby_clothing', 'Baby Clothing', 'kids'], ['kids.shoes', 'Kids Shoes', 'kids'], ['kids.toys', 'Toys', 'none'],
  // Home
  ['home.decor', 'Decor', 'none'], ['home.kitchen_dining', 'Kitchen & Dining', 'none'], ['home.bedding_bath', 'Bedding & Bath', 'none'],
  // Electronics
  ['electronics.phones', 'Cell Phones', 'none'], ['electronics.computers_tablets', 'Computers & Tablets', 'none'],
  ['electronics.video_games', 'Video Games & Consoles', 'none'], ['electronics.audio', 'Audio & Headphones', 'none'],
  ['electronics.cameras', 'Cameras', 'none'],
  // Collectibles & media
  ['collectibles.trading_cards', 'Trading Cards', 'none'], ['collectibles.vinyl_records', 'Vinyl Records', 'none'],
  ['collectibles.books', 'Books', 'none'], ['collectibles.toys_figures', 'Action Figures & Collectible Toys', 'none'],
  // Other
  ['other.other', 'Other', 'none'],
];

function parentOf(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i === -1 ? null : id.slice(0, i);
}

export const CATEGORIES: CategoryNode[] = [
  ...DEPARTMENTS.map(([id, label, sizeType]) => ({ id, label, parentId: null, selectable: false, sizeType })),
  ...GROUPS.map(([id, label, sizeType]) => ({ id, label, parentId: parentOf(id), selectable: false, sizeType })),
  ...LEAVES.map(([id, label, sizeType]) => ({ id, label, parentId: parentOf(id), selectable: true, sizeType })),
];

export const CATEGORY_BY_ID: Map<string, CategoryNode> = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string | null | undefined): CategoryNode | undefined {
  return id ? CATEGORY_BY_ID.get(id) : undefined;
}

/** ['women','women.shoes','women.shoes.sneakers'] → nodes from root to leaf. */
export function categoryAncestry(id: string): CategoryNode[] {
  const out: CategoryNode[] = [];
  let cur = getCategory(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? getCategory(cur.parentId) : undefined;
  }
  return out;
}

/** "Women › Shoes › Sneakers" */
export function categoryPathLabel(id: string): string {
  return categoryAncestry(id).map((c) => c.label).join(' › ');
}

/** First segment: 'women' | 'men' | ... */
export function departmentOf(id: string): string {
  return id.split('.')[0] ?? id;
}

/** Walk up ancestry (leaf first); first defined sizeType; default 'none'. */
export function sizeTypeOf(id: string | null | undefined): SizeType {
  if (!id) return 'none';
  const chain = categoryAncestry(id);
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i]?.sizeType;
    if (t) return t;
  }
  return 'none';
}

export function isSelectableCategory(id: string): boolean {
  return getCategory(id)?.selectable === true;
}

/** Lookup helper for adapter maps: tries id, then each ancestor id, returns first hit. */
export function lookupByCategory<T>(map: Partial<Record<string, T>>, id: string): T | undefined {
  let cur: string | null = id;
  while (cur) {
    const hit = map[cur];
    if (hit !== undefined) return hit;
    cur = parentOf(cur);
  }
  return undefined;
}
