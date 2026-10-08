import { describe, expect, it } from 'vitest';
import { buildItemXml, cdata, descriptionToHtml, escapeXml } from '../../../src/server/marketplaces/ebay/xml';

const base = {
  title: 'Levi\'s 501 <Jeans> & "more"', description: 'Line one\nline two\n\nSecond <b>paragraph</b> ]]> end', priceCents: 6500,
  conditionNotes: 'Small stain', quantity: 2, sku: 'CL-00001',
  shipping: { weightOz: 20, lengthIn: 12, widthIn: 10, heightIn: 3, whoPays: 'buyer' as const },
};
const settings = { ebay: { fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1', postalCode: '94107', dispatchTimeDays: 2 } };

describe('xml helpers', () => {
  it('escapes XML', () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
    expect(escapeXml('a\u0001b')).toBe('ab');
  });
  it('splits ]]> inside CDATA', () => {
    expect(cdata('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>');
    expect(cdata('plain')).toBe('<![CDATA[plain]]>');
  });
  it('converts a description to HTML', () => {
    expect(descriptionToHtml('Line one\nline two\n\nSecond <b>x</b> & more')).toBe('<p>Line one<br>line two</p><p>Second &lt;b&gt;x&lt;/b&gt; &amp; more</p>');
    expect(descriptionToHtml('  ')).toBe('');
  });
});

describe('buildItemXml', () => {
  it('builds the full item with every optional block', () => {
    const xml = buildItemXml(base, { categoryId: '11483', bestOffer: true }, settings, ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg'], 3000,
      { Brand: ["Levi's"], Color: ['Blue', 'Black'] });
    expect(xml).toBe(
      '<Item>'
      + '<Title>Levi&apos;s 501 &lt;Jeans&gt; &amp; &quot;more&quot;</Title>'
      + '<Description><![CDATA[<p>Line one<br>line two</p><p>Second &lt;b&gt;paragraph&lt;/b&gt; ]]&gt; end</p>]]></Description>'
      + '<PrimaryCategory><CategoryID>11483</CategoryID></PrimaryCategory>'
      + '<StartPrice currencyID="USD">65.00</StartPrice>'
      + '<CategoryMappingAllowed>true</CategoryMappingAllowed>'
      + '<ConditionID>3000</ConditionID>'
      + '<ConditionDescription>Small stain</ConditionDescription>'
      + '<Country>US</Country><Currency>USD</Currency>'
      + '<DispatchTimeMax>2</DispatchTimeMax>'
      + '<ListingDuration>GTC</ListingDuration>'
      + '<ListingType>FixedPriceItem</ListingType>'
      + '<PostalCode>94107</PostalCode>'
      + '<Quantity>2</Quantity>'
      + '<SKU>CL-00001</SKU>'
      + '<PictureDetails><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL><PictureURL>https://i.ebayimg.com/2.jpg</PictureURL></PictureDetails>'
      + '<ItemSpecifics><NameValueList><Name>Brand</Name><Value>Levi&apos;s</Value></NameValueList><NameValueList><Name>Color</Name><Value>Blue</Value><Value>Black</Value></NameValueList></ItemSpecifics>'
      + '<SellerProfiles><SellerShippingProfile><ShippingProfileID>F1</ShippingProfileID></SellerShippingProfile>'
      + '<SellerReturnProfile><ReturnProfileID>R1</ReturnProfileID></SellerReturnProfile>'
      + '<SellerPaymentProfile><PaymentProfileID>P1</PaymentProfileID></SellerPaymentProfile></SellerProfiles>'
      + '<ShippingPackageDetails><WeightMajor unit="lbs">1</WeightMajor><WeightMinor unit="oz">4</WeightMinor>'
      + '<PackageDepth unit="in">3</PackageDepth><PackageLength unit="in">12</PackageLength><PackageWidth unit="in">10</PackageWidth></ShippingPackageDetails>'
      + '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>'
      + '</Item>');
  });
  it('omits optional blocks: no weight, no dimensions, no best offer, no condition description for new items', () => {
    const noWeight = buildItemXml({ ...base, shipping: { ...base.shipping, weightOz: null } }, { categoryId: '1' }, settings, [], 1000, {});
    expect(noWeight).not.toContain('ShippingPackageDetails');
    expect(noWeight).not.toContain('BestOfferDetails');
    expect(noWeight).not.toContain('ConditionDescription');
    const noDims = buildItemXml({ ...base, shipping: { ...base.shipping, heightIn: null } }, { categoryId: '1' }, settings, [], 3000, {});
    expect(noDims).toContain('<WeightMajor');
    expect(noDims).not.toContain('PackageDepth');
    expect(noDims).toContain('<ItemSpecifics></ItemSpecifics>');
  });
});
