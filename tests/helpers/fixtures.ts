import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { TEST_HEADERS, req } from './testApp';

/** Solid color image with a drawn rectangle so perceptual hashes differ by shape/position. */
function base(width: number, height: number, color: string, rect: 'left' | 'right' | 'top' = 'left') {
  const rw = Math.round(width / 3);
  const rh = Math.round(height / 3);
  const left = rect === 'left' ? Math.round(width / 6) : rect === 'right' ? width - rw - Math.round(width / 6) : Math.round(width / 3);
  const top = rect === 'top' ? Math.round(height / 12) : Math.round(height / 3);
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${left}" y="${top}" width="${rw}" height="${rh}" fill="#ffffff"/></svg>`,
  );
  return sharp({ create: { width, height, channels: 3, background: color } }).composite([{ input: overlay }]);
}

export async function makeJpeg(width = 800, height = 600, color = '#3366cc', rect: 'left' | 'right' | 'top' = 'left'): Promise<Buffer> {
  return base(width, height, color, rect).jpeg({ quality: 90 }).toBuffer();
}
export async function makePng(width = 800, height = 600, color = '#cc6633', rect: 'left' | 'right' | 'top' = 'left'): Promise<Buffer> {
  return base(width, height, color, rect).png().toBuffer();
}
/** A 400x200 JPEG tagged with EXIF orientation 6 (displays as 200x400). */
export async function makeExifRotatedJpeg(): Promise<Buffer> {
  return base(400, 200, '#33aa55').withMetadata({ orientation: 6 }).jpeg().toBuffer();
}
/** JPEG carrying EXIF data (to prove it is stripped from derived files). */
export async function makeJpegWithExif(): Promise<Buffer> {
  return base(600, 400, '#aa3355').withExif({ IFD0: { Copyright: 'secret-copyright' } }).jpeg().toBuffer();
}

export function multipart(files: Array<{ name: string; buffer: Buffer; type: string }>): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----crosslistertest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    chunks.push(f.buffer, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { ...TEST_HEADERS, 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function uploadPhotos(app: FastifyInstance, listingId: string, files: Array<{ name: string; buffer: Buffer; type: string }>) {
  const { payload, headers } = multipart(files);
  return app.inject({ method: 'POST', url: `/api/listings/${listingId}/photos`, payload, headers });
}

/** Creates a complete, ready-to-list listing with one photo. */
export async function seedListing(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const res = await req(app, 'POST', '/api/listings', {
    title: 'Vintage Levi 501 Jeans', description: 'Great jeans.', priceCents: 6500, condition: 'good',
    categoryId: 'men.bottoms.jeans', brand: "Levi's", size: '32', colors: ['blue'],
    shipping: { weightOz: 16, lengthIn: 12, widthIn: 10, heightIn: 3, whoPays: 'buyer' },
    ...overrides,
  });
  const listing = res.json();
  await uploadPhotos(app, listing.id, [{ name: 'a.jpg', buffer: await makeJpeg(), type: 'image/jpeg' }]);
  return (await req(app, 'GET', `/api/listings/${listing.id}`)).json();
}
