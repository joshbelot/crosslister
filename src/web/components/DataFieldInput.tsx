import { useEffect, useState } from 'react';
import type { DataFieldDef } from '../../shared/types';
import { PriceInput } from './fields/PriceInput';
import { TagsInput } from './fields/TagsInput';
import { EbayAspectsField, EbayCategoryField, EbayConditionField } from './EbayFields';

/** Renders one marketplace-specific `dataFields` entry. `onCommit` saves (called on change for discrete inputs, on blur for text). */
export function DataFieldInput({ def, value, onCommit, onCommitMany, data, listingId, marketplaceId }: {
  def: DataFieldDef; value: unknown; onCommit: (v: unknown) => void; onCommitMany?: (patch: Record<string, unknown>) => void;
  data: Record<string, unknown>; listingId: string; marketplaceId?: string;
}) {
  const id = `data-${def.key}`;
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => { setText(value === undefined || value === null ? '' : String(value)); }, [value]);

  let input: React.ReactNode;
  switch (def.type) {
    case 'textarea':
      input = <textarea id={id} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text || undefined)} />;
      break;
    case 'number':
      input = <input id={id} className="input" type="number" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text === '' ? undefined : Number(text))} />;
      break;
    case 'money':
      input = <PriceInput id={id} value={typeof value === 'number' ? value : null} onChange={(c) => onCommit(c ?? undefined)} />;
      break;
    case 'boolean':
      input = <label className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onCommit(e.target.checked)} /> Yes</label>;
      break;
    case 'select':
      if (marketplaceId === 'ebay' && def.key === 'conditionId') { input = <EbayConditionField data={data} value={value} onCommit={onCommit} />; break; }
      input = (
        <select id={id} className="input" value={text} onChange={(e) => onCommit(e.target.value || undefined)}>
          <option value="">Automatic</option>
          {(def.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'tags':
      input = <TagsInput id={id} value={Array.isArray(value) ? (value as string[]) : []} max={def.maxItems ?? 20} onChange={(t) => onCommit(t)} />;
      break;
    case 'path':
      input = <input id={id} className="input" placeholder="Women > Shoes > Sneakers" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text.trim() || undefined)} />;
      break;
    case 'ebay_category':
      input = <EbayCategoryField data={data} onCommitMany={onCommitMany ?? ((p) => Object.entries(p).forEach(([k, v]) => onCommit(v ?? k)))} />;
      break;
    case 'ebay_aspects':
      input = <EbayAspectsField data={data} value={value} onCommit={onCommit} listingId={listingId} />;
      break;
    default:
      input = <input id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(text || undefined)} />;
  }
  return (
    <div>
      <label className="label" htmlFor={id}>{def.label}</label>
      {input}
      {def.help && <p className="help">{def.help}</p>}
    </div>
  );
}
