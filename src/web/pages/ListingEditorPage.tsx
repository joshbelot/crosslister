import { useEffect, useRef, useState } from 'react';
import { AiAttributesCard, AiDescriptionButton, AiTitleButton } from '../components/AiSuggest';
import { ChevronDown, ChevronRight, Send } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import clsx from 'clsx';

import { departmentOf } from '../../shared/taxonomy';
import type { Measurements } from '../../shared/types';
import { useMarketplaces, useUpdateRemote, useValidation } from '../api/hooks';
import { MARKETPLACE_NAMES } from '../../shared/constants';
import { setUi } from '../lib/ui';
import { BrandInput } from '../components/fields/BrandInput';
import { CategoryPicker } from '../components/fields/CategoryPicker';
import { ColorPicker } from '../components/fields/ColorPicker';
import { ConditionPicker } from '../components/fields/ConditionPicker';
import { PriceInput } from '../components/fields/PriceInput';
import { SizeInput } from '../components/fields/SizeInput';
import { TagsInput } from '../components/fields/TagsInput';
import { PhotoManager, type PhotoManagerHandle } from '../components/photos/PhotoManager';
import { SaveIndicator } from '../components/SaveIndicator';
import { useHotkeys } from '../lib/keyboard';
import { useListingDraft } from '../lib/useListingDraft';
import { MarketplaceChips } from '../components/MarketplaceChips';
import { CrosslistFlow } from '../components/CrosslistFlow';

const APPAREL: Array<[keyof Measurements, string]> = [
  ['chestIn', 'Chest'], ['waistIn', 'Waist'], ['hipIn', 'Hip'], ['inseamIn', 'Inseam'], ['riseIn', 'Rise'], ['lengthIn', 'Length'], ['shoulderIn', 'Shoulder'], ['sleeveIn', 'Sleeve'],
];
const OBJECT: Array<[keyof Measurements, string]> = [['widthIn', 'Width'], ['heightIn', 'Height'], ['depthIn', 'Depth']];

function Field({ label, htmlFor, help, children, className }: { label: string; htmlFor?: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <p className="help">{help}</p>}
    </div>
  );
}

function NumberInput({ id, value, onChange, step = 'any', placeholder }: { id?: string; value: number | null | undefined; onChange: (n: number | null) => void; step?: string; placeholder?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value === null || value === undefined ? '' : String(value)); }, [value]);
  return (
    <input id={id} className="input" inputMode="decimal" step={step} placeholder={placeholder} value={text}
      onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(value === null || value === undefined ? '' : String(value)); }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() === '') onChange(null);
        else if (Number.isFinite(n) && n > 0) onChange(n);
      }} />
  );
}

export function ListingEditorPage() {
  const { id = 'new' } = useParams();
  const [params, setParams] = useSearchParams();
  const draft = useListingDraft(id);
  const { values, setField, listing } = draft;
  const marketplaces = useMarketplaces().data ?? [];
  const photoRef = useRef<PhotoManagerHandle>(null);
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem('editor.moreOpen') === '1'; } catch { return false; } });
  const [validationOpen, setValidationOpen] = useState(false);
  const [overridesFor, setOverridesFor] = useState<string | null>(null);

  const toggleMore = () => setMoreOpen((o) => { const n = !o; try { localStorage.setItem('editor.moreOpen', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  const selectedInfos = marketplaces.filter((m) => draft.selected.includes(m.id));
  const titleLimit = selectedInfos.reduce<number | null>((min, m) => (m.capabilities.titleMaxLength !== null && (min === null || m.capabilities.titleMaxLength < min) ? m.capabilities.titleMaxLength : min), null);
  const titleShort = selectedInfos.filter((m) => m.capabilities.titleMaxLength !== null && values.title.length > m.capabilities.titleMaxLength).map((m) => m.name);
  const descLimit = selectedInfos.reduce<number | null>((min, m) => (min === null || m.capabilities.descriptionMaxLength < min ? m.capabilities.descriptionMaxLength : min), null);

  // "Push changes?" banner (05 §7.5): the item is live somewhere and title/description/price changed since this page loaded.
  const updateRemote = useUpdateRemote();
  const [baseline, setBaseline] = useState<{ title: string; description: string; priceCents: number | null } | null>(null);
  useEffect(() => {
    if (listing && !baseline) setBaseline({ title: listing.title, description: listing.description, priceCents: listing.priceCents });
  }, [listing, baseline]);
  const liveTargets = (listing?.marketplaces ?? []).filter((m) => m.status === 'active' && marketplaces.find((x) => x.id === m.marketplaceId)?.capabilities.update !== 'none');
  const pushChanged = Boolean(listing && baseline && liveTargets.length > 0
    && (listing.title !== baseline.title || listing.description !== baseline.description || listing.priceCents !== baseline.priceCents));
  const pushChanges = async () => {
    await draft.flush();
    if (!listing) return;
    for (const m of liveTargets) updateRemote.mutate({ id: listing.id, mp: m.marketplaceId });
    setBaseline({ title: listing.title, description: listing.description, priceCents: listing.priceCents });
    setUi({ drawerOpen: true });
  };

  const validation = useValidation(draft.listingId ?? undefined, draft.selected, true);
  const readyCount = validation.data?.marketplaces.filter((m) => m.ready).length ?? 0;
  const needInfo = (validation.data?.marketplaces.length ?? 0) - readyCount;

  const openCrosslist = async () => { await draft.flush(); await draft.ensureCreated(); setValidationOpen(true); };
  const crosslistParam = params.get('crosslist') === '1';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!crosslistParam || autoOpened.current || !listing) return;
    autoOpened.current = true;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('crosslist'); return n; }, { replace: true });
    setValidationOpen(true);
  }, [crosslistParam, listing, setParams]);

  useHotkeys({
    'mod+s': () => { void draft.flush(); },
    'mod+enter': () => { void openCrosslist(); },
  });

  const focusField = (rawName: string) => {
    const MORE = ['msrpCents', 'weight-lb', 'model', 'material', 'conditionNotes', 'quantity'];
    const name = rawName === 'shipping.weightOz' ? 'weight-lb' : rawName.startsWith('data') ? 'title' : rawName;
    if (MORE.includes(name)) { setMoreOpen(true); try { localStorage.setItem('editor.moreOpen', '1'); } catch { /* ignore */ } }
    setTimeout(() => {
      const el = document.getElementById(`field-${name}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => (el?.matches('input,textarea,select,button') ? el : el?.querySelector<HTMLElement>('input,button,textarea'))?.focus(), 150);
    }, MORE.includes(name) ? 80 : 0);
  };

  const dept = values.categoryId ? departmentOf(values.categoryId) : null;
  const measurementFields = dept && ['women', 'men', 'kids'].includes(dept) ? APPAREL : OBJECT;
  const weightOz = values.shipping.weightOz;
  const lb = weightOz === null ? '' : String(Math.floor(weightOz / 16));
  const oz = weightOz === null ? '' : String(Math.round((weightOz % 16) * 10) / 10);
  const setWeight = (nextLb: string, nextOz: string) => {
    if (nextLb.trim() === '' && nextOz.trim() === '') return setField('shipping', { ...values.shipping, weightOz: null });
    const total = (Number(nextLb) || 0) * 16 + (Number(nextOz) || 0);
    setField('shipping', { ...values.shipping, weightOz: total > 0 ? total : null });
  };
  const setDim = (key: 'lengthIn' | 'widthIn' | 'heightIn', n: number | null) => setField('shipping', { ...values.shipping, [key]: n });

  const descRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = descRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight, 120)}px`; }
  }, [values.description]);

  const valuesTitleRef = useRef(values.title);
  valuesTitleRef.current = values.title;

  if (draft.notFound) return <div className="p-8 text-center text-zinc-600">That listing was not found.</div>;
  if (draft.loading) return <div className="p-8 text-center text-zinc-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 pb-32 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{values.title.trim() || (draft.listingId ? 'Untitled listing' : 'New Listing')}</h1>
          {listing && <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600">{listing.sku}</span>}
        </div>
        <SaveIndicator state={draft.saveState} />
      </div>

      <div className="space-y-6">
        <div className="card p-5">
          <PhotoManager ref={photoRef} listingId={draft.listingId} photos={listing?.photos ?? []} ensureCreated={draft.ensureCreated}
            onUploaded={() => { if (!valuesTitleRef.current) focusField('title'); }} />
          <AiAttributesCard ensureId={async () => { const id = await draft.ensureCreated(); await draft.flush(); return id; }} photoCount={listing?.photos.length ?? 0}
            onApply={(v) => {
              if (v.brand) setField('brand', v.brand);
              if (v.categoryId) setField('categoryId', v.categoryId);
              if (v.colors) setField('colors', v.colors as never);
              if (v.size) setField('size', v.size);
            }} />
        </div>

        <div className="card grid grid-cols-2 gap-x-6 gap-y-5 p-5">
          <div className="col-span-2">
            <div className="flex items-end justify-between">
              <label className="label" htmlFor="field-title">Title</label>
              <span className="flex items-center gap-2">
              <AiTitleButton ensureId={async () => { const id = await draft.ensureCreated(); await draft.flush(); return id; }} marketplaceIds={draft.selected}
                onUse={(t) => setField('title', t)} />
              {titleLimit !== null && (
                <span title={titleShort.length ? `Will be shortened on ${titleShort.join(', ')}` : undefined}
                  className={clsx('mb-1 text-xs', titleShort.length ? 'text-amber-600' : 'text-zinc-400')}>{values.title.length} / {titleLimit}</span>
              )}
              </span>
            </div>
            <input id="field-title" className="input" value={values.title} placeholder="e.g. Vintage Levi's 501 Jeans 32x30" onChange={(e) => setField('title', e.target.value)} />
          </div>
          <div className="col-span-2">
            <div className="flex items-end justify-between">
              <label className="label" htmlFor="field-description">Description</label>
              <span className="flex items-center gap-2">
                <AiDescriptionButton ensureId={async () => { const id = await draft.ensureCreated(); await draft.flush(); return id; }}
                  onUse={(text, mode) => setField('description', mode === 'append' && values.description.trim() ? `${values.description.trimEnd()}\n\n${text}` : text)} />
                {descLimit !== null && <span className={clsx('mb-1 text-xs', values.description.length > descLimit ? 'text-red-600' : 'text-zinc-400')}>{values.description.length} / {descLimit}</span>}
              </span>
            </div>
            <textarea id="field-description" ref={descRef} className="input min-h-[120px] resize-none overflow-hidden" rows={5} value={values.description}
              onChange={(e) => setField('description', e.target.value)} />
          </div>
          <Field label="Price" htmlFor="field-priceCents"><PriceInput id="field-priceCents" value={values.priceCents} onChange={(v) => setField('priceCents', v)} /></Field>
          <Field label="Condition"><ConditionPicker id="field-condition" value={values.condition} onChange={(c) => setField('condition', c)} /></Field>
          <Field label="Brand" htmlFor="field-brand"><BrandInput id="field-brand" value={values.brand} onChange={(v) => setField('brand', v)} /></Field>
          <Field label="Category" htmlFor="field-categoryId">
            <CategoryPicker id="field-categoryId" value={values.categoryId} onChange={(c) => setField('categoryId', c)}
              onPicked={() => focusField(document.getElementById('field-size')?.hasAttribute('disabled') ? 'colors' : 'size')} />
          </Field>
          <Field label="Size" htmlFor="field-size"><SizeInput id="field-size" value={values.size} categoryId={values.categoryId} onChange={(v) => setField('size', v)} /></Field>
          <Field label="Color"><ColorPicker id="field-colors" value={values.colors} onChange={(c) => setField('colors', c)} /></Field>
        </div>

        <div className="card">
          <button type="button" className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-zinc-700" onClick={toggleMore} aria-expanded={moreOpen}>
            {moreOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
          </button>
          {moreOpen && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-zinc-100 p-5">
              <Field label="Model" htmlFor="field-model"><input id="field-model" className="input" value={values.model} onChange={(e) => setField('model', e.target.value)} /></Field>
              <Field label="Original price (MSRP)" htmlFor="field-msrpCents" help="Required by Poshmark"><PriceInput id="field-msrpCents" value={values.msrpCents} onChange={(v) => setField('msrpCents', v)} /></Field>
              <Field label="Material" htmlFor="field-material"><input id="field-material" className="input" value={values.material} onChange={(e) => setField('material', e.target.value)} /></Field>
              <Field label="Quantity" htmlFor="field-quantity">
                <input id="field-quantity" type="number" min={1} className="input" value={values.quantity}
                  onChange={(e) => setField('quantity', Math.max(1, Math.round(Number(e.target.value)) || 1))} />
              </Field>
              <Field className="col-span-2" label="Condition notes" htmlFor="field-conditionNotes" help="Flaws or notes — added to the description automatically">
                <textarea id="field-conditionNotes" className="input" rows={3} value={values.conditionNotes} onChange={(e) => setField('conditionNotes', e.target.value)} />
              </Field>
              <div className="col-span-2">
                <span className="label">Measurements (inches)</span>
                <div className="grid grid-cols-4 gap-3">
                  {measurementFields.map(([key, label]) => (
                    <div key={key}>
                      <label className="help !mt-0 mb-0.5 block" htmlFor={`field-m-${key}`}>{label}</label>
                      <NumberInput id={`field-m-${key}`} value={values.measurements[key]}
                        onChange={(n) => { const m = { ...values.measurements }; if (n === null) delete m[key]; else m[key] = n; setField('measurements', m); }} />
                    </div>
                  ))}
                </div>
              </div>
              <Field className="col-span-2" label="Tags" htmlFor="field-tags"><TagsInput id="field-tags" value={values.tags} onChange={(t) => setField('tags', t)} /></Field>
              <div className="col-span-2">
                <span className="label">Shipping</span>
                <div className="grid grid-cols-6 items-end gap-3">
                  <div><label className="help !mt-0 mb-0.5 block" htmlFor="field-weight-lb">Weight (lb)</label>
                    <input id="field-weight-lb" className="input" inputMode="decimal" value={lb} onChange={(e) => setWeight(e.target.value, oz)} /></div>
                  <div><label className="help !mt-0 mb-0.5 block" htmlFor="field-weight-oz">Weight (oz)</label>
                    <input id="field-weight-oz" className="input" inputMode="decimal" value={oz} onChange={(e) => setWeight(lb, e.target.value)} /></div>
                  {([['lengthIn', 'Length (in)'], ['widthIn', 'Width (in)'], ['heightIn', 'Height (in)']] as const).map(([k, label]) => (
                    <div key={k}><label className="help !mt-0 mb-0.5 block" htmlFor={`field-${k}`}>{label}</label>
                      <NumberInput id={`field-${k}`} value={values.shipping[k]} onChange={(n) => setDim(k, n)} /></div>
                  ))}
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300" role="radiogroup" aria-label="Who pays shipping">
                    {(['buyer', 'seller'] as const).map((w) => (
                      <button key={w} type="button" role="radio" aria-checked={values.shipping.whoPays === w}
                        className={clsx('h-10 flex-1 text-sm capitalize', values.shipping.whoPays === w ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50')}
                        onClick={() => setField('shipping', { ...values.shipping, whoPays: w })}>{w}</button>
                    ))}
                  </div>
                </div>
              </div>
              <Field label="Cost (private)" htmlFor="field-costCents" help="Only for your records"><PriceInput id="field-costCents" value={values.costCents} onChange={(v) => setField('costCents', v)} /></Field>
              <Field label="Private notes" htmlFor="field-notes" help="Never sent to marketplaces">
                <textarea id="field-notes" className="input" rows={3} value={values.notes} onChange={(e) => setField('notes', e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">Cross-list to</h2>
            <button type="button" className="text-sm text-indigo-600 hover:underline disabled:text-zinc-400" disabled={draft.selected.length === 0}
              onClick={() => { void draft.ensureCreated().then(() => setOverridesFor(draft.selected[0] ?? null)); }}>Customize per marketplace</button>
          </div>
          <MarketplaceChips selected={draft.selected} onChange={draft.setSelected} />
        </div>
      </div>

      {pushChanged && listing && (
        <div className="fixed inset-x-0 bottom-[65px] z-20 border-t border-amber-200 bg-amber-50" data-testid="push-banner">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-2.5 text-sm text-amber-900">
            <span>This item is live on {liveTargets.map((m) => MARKETPLACE_NAMES[m.marketplaceId]).join(', ')}. Push changes? <span className="text-amber-700">(Title, description and price only — photos and category aren't updated.)</span></span>
            <span className="flex shrink-0 gap-2">
              <button className="btn btn-primary btn-sm" disabled={updateRemote.isPending} onClick={() => void pushChanges()}>Update listings</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setBaseline({ title: listing.title, description: listing.description, priceCents: listing.priceCents })}>Not now</button>
            </span>
          </div>
        </div>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <SaveIndicator state={draft.saveState} />
          <button type="button" className="text-sm text-zinc-600 hover:underline" onClick={() => void openCrosslist()} disabled={draft.selected.length === 0}>
            {draft.selected.length === 0 ? 'Choose marketplaces to cross-list' : validation.data ? `${readyCount} ready${needInfo > 0 ? ` · ${needInfo} needs info` : ''}` : '…'}
          </button>
          <button className="btn btn-primary" onClick={() => void openCrosslist()} disabled={draft.selected.length === 0}>
            <Send size={16} /> Cross-List Item <span className="kbd !border-indigo-400 !bg-indigo-500 !text-indigo-100">⌘↵</span>
          </button>
        </div>
      </footer>

      <CrosslistFlow listingId={draft.listingId} selected={draft.selected} open={validationOpen} onClose={() => setValidationOpen(false)}
        focusField={focusField} overridesFor={overridesFor} setOverridesFor={setOverridesFor} />
    </div>
  );
}
