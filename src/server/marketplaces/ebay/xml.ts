import type { Settings } from '../../../shared/types';
import type { EffectiveListing } from '../types';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** CDATA section that is safe even when the text contains `]]>`. */
export function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** Plain text → minimal HTML: escape, paragraphs on blank lines, <br> on single newlines. */
export function descriptionToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.trim().split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim()).replace(/\r?\n/g, '<br>')}</p>`).join('');
}

export interface EbayItemData { categoryId?: string; bestOffer?: boolean }

export function buildItemXml(
  l: Pick<EffectiveListing, 'title' | 'description' | 'priceCents' | 'conditionNotes' | 'quantity' | 'sku' | 'shipping'>,
  data: EbayItemData,
  settings: Pick<Settings, 'ebay'>,
  pictureUrls: string[],
  conditionId: number,
  aspects: Record<string, string[]>,
): string {
  const e = settings.ebay;
  const price = ((l.priceCents ?? 0) / 100).toFixed(2);
  const specifics = Object.entries(aspects).filter(([, v]) => v.length > 0)
    .map(([name, values]) => `<NameValueList><Name>${escapeXml(name)}</Name>${values.map((v) => `<Value>${escapeXml(v)}</Value>`).join('')}</NameValueList>`).join('');
  const oz = l.shipping.weightOz;
  const dims = [l.shipping.lengthIn, l.shipping.widthIn, l.shipping.heightIn].every((x) => x !== null);
  const pkg = oz === null ? '' : `<ShippingPackageDetails><WeightMajor unit="lbs">${Math.floor(oz / 16)}</WeightMajor><WeightMinor unit="oz">${Math.ceil(oz % 16)}</WeightMinor>${
    dims ? `<PackageDepth unit="in">${l.shipping.heightIn}</PackageDepth><PackageLength unit="in">${l.shipping.lengthIn}</PackageLength><PackageWidth unit="in">${l.shipping.widthIn}</PackageWidth>` : ''
  }</ShippingPackageDetails>`;
  return [
    '<Item>',
    `<Title>${escapeXml(l.title)}</Title>`,
    `<Description>${cdata(descriptionToHtml(l.description))}</Description>`,
    `<PrimaryCategory><CategoryID>${escapeXml(data.categoryId ?? '')}</CategoryID></PrimaryCategory>`,
    `<StartPrice currencyID="USD">${price}</StartPrice>`,
    '<CategoryMappingAllowed>true</CategoryMappingAllowed>',
    `<ConditionID>${conditionId}</ConditionID>`,
    conditionId >= 2000 && l.conditionNotes.trim() ? `<ConditionDescription>${escapeXml(l.conditionNotes.trim().slice(0, 1000))}</ConditionDescription>` : '',
    '<Country>US</Country><Currency>USD</Currency>',
    `<DispatchTimeMax>${e.dispatchTimeDays}</DispatchTimeMax>`,
    '<ListingDuration>GTC</ListingDuration>',
    '<ListingType>FixedPriceItem</ListingType>',
    `<PostalCode>${escapeXml(e.postalCode)}</PostalCode>`,
    `<Quantity>${l.quantity}</Quantity>`,
    `<SKU>${escapeXml(l.sku)}</SKU>`,
    `<PictureDetails>${pictureUrls.map((u) => `<PictureURL>${escapeXml(u)}</PictureURL>`).join('')}</PictureDetails>`,
    `<ItemSpecifics>${specifics}</ItemSpecifics>`,
    '<SellerProfiles>',
    `<SellerShippingProfile><ShippingProfileID>${escapeXml(e.fulfillmentPolicyId ?? '')}</ShippingProfileID></SellerShippingProfile>`,
    `<SellerReturnProfile><ReturnProfileID>${escapeXml(e.returnPolicyId ?? '')}</ReturnProfileID></SellerReturnProfile>`,
    `<SellerPaymentProfile><PaymentProfileID>${escapeXml(e.paymentPolicyId ?? '')}</PaymentProfileID></SellerPaymentProfile>`,
    '</SellerProfiles>',
    pkg,
    data.bestOffer ? '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>' : '',
    '</Item>',
  ].filter(Boolean).join('');
}
