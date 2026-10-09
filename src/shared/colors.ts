export const COLORS = [
  { id: 'black', label: 'Black', hex: '#111111' }, { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'gray', label: 'Gray', hex: '#9ca3af' }, { id: 'brown', label: 'Brown', hex: '#7c4a21' },
  { id: 'tan', label: 'Tan', hex: '#d2b48c' }, { id: 'beige', label: 'Beige', hex: '#e8dcc4' },
  { id: 'cream', label: 'Cream', hex: '#fffdd0' }, { id: 'red', label: 'Red', hex: '#dc2626' },
  { id: 'pink', label: 'Pink', hex: '#f472b6' }, { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' }, { id: 'green', label: 'Green', hex: '#16a34a' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' }, { id: 'navy', label: 'Navy', hex: '#1e3a8a' },
  { id: 'purple', label: 'Purple', hex: '#9333ea' }, { id: 'gold', label: 'Gold', hex: '#d4af37' },
  { id: 'silver', label: 'Silver', hex: '#c0c0c0' }, { id: 'multicolor', label: 'Multicolor', hex: 'conic-gradient' },
] as const;
export type ColorId = (typeof COLORS)[number]['id'];
export const COLOR_IDS: ColorId[] = COLORS.map((c) => c.id);
export const MAX_COLORS = 2;
