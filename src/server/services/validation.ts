import type { Listing, ValidationIssue } from '../../shared/types';

/** Rules that apply to every marketplace (05 §4.1). */
export function validateCanonical(listing: Listing, photoCount: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, severity: 'error', message });
  const warn = (field: string, message: string) => issues.push({ field, severity: 'warning', message });
  if (!listing.title.trim()) err('title', 'Add a title.');
  if (photoCount === 0) err('photos', 'Add at least one photo.');
  if (!listing.priceCents) err('priceCents', 'Add a price.');
  if (!listing.condition) err('condition', 'Choose a condition.');
  if (!listing.categoryId) err('categoryId', 'Choose a category.');
  if (!listing.description.trim()) warn('description', 'Add a description — buyers rarely purchase without one.');
  if (listing.quantity > 1) warn('quantity', 'Quantity is only sent to eBay; other marketplaces list one item.');
  return issues;
}
