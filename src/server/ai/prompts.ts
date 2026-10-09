import { CONDITION_HINTS, CONDITION_LABELS } from '../../shared/constants';
import { categoryPathLabel } from '../../shared/taxonomy';
import type { Listing } from '../../shared/types';

export const SYSTEM_PROMPT = `You help a person write listings for second-hand items they are selling.
Rules:
- Use ONLY facts given in the item details or clearly visible in the photos. Never invent brand, size, materials, measurements, defects, model names, dates or history.
- If something is unknown, leave it out. Do not guess.
- Be honest about condition and flaws exactly as provided.
- No emojis, no hashtags unless asked, no ALL CAPS, no claims like "authentic" or "rare" unless provided.
- Respond in the exact JSON format requested.`;

/** Plain list of the known facts; empty fields are omitted. */
export function renderItemDetails(l: Listing): string {
  const rows: Array<[string, string]> = [
    ['Title', l.title],
    ['Brand', l.brand],
    ['Model', l.model],
    ['Category', l.categoryId ? categoryPathLabel(l.categoryId) : ''],
    ['Size', l.size],
    ['Colors', l.colors.join(', ')],
    ['Material', l.material],
    ['Condition', l.condition ? `${CONDITION_LABELS[l.condition]} (${CONDITION_HINTS[l.condition]})` : ''],
    ['Condition notes', l.conditionNotes],
    ['Measurements', Object.entries(l.measurements).map(([k, v]) => `${k}: ${v} in`).join(', ')],
    ['Tags', l.tags.join(', ')],
    ["Seller's notes for the description", l.description],
  ];
  return rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}
