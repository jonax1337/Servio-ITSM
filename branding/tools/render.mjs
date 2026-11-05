import sharp from 'sharp';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = JSON.parse(await readFile(resolve(root, '.build/jobs.json'), 'utf8'));

async function renderPng(job) {
  const input = await readFile(resolve(root, job.source));
  const nativeWidth = Number(input.toString().match(/<svg[^>]*\bwidth="([\d.]+)"/)[1]);
  const density = Math.ceil(72 * job.width / nativeWidth);
  const destination = resolve(root, job.target);
  await mkdir(dirname(destination), { recursive: true });
  await sharp(input, { density }).resize(job.width, job.height).png().toFile(destination);
  const metadata = await sharp(destination).metadata();
  if (metadata.width !== job.width || metadata.height !== job.height) {
    throw new Error(`Wrong dimensions: ${job.target}`);
  }
}

for (let start = 0; start < jobs.length; start += 6) {
  await Promise.all(jobs.slice(start, start + 6).map(renderPng));
}
console.log(`Rendered and checked ${jobs.length} PNG assets.`);

const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(pathToFileURL(resolve(root, 'brand-guide.html')).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  const overflow = await page.locator('.page').evaluateAll(pages => pages.map((element, index) => ({
    page: index + 1, horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  })).filter(item => item.horizontal || item.vertical));
  if (overflow.length) throw new Error(`Guide overflow: ${JSON.stringify(overflow)}`);
  await page.pdf({ path: resolve(root, 'brand-guide.pdf'), printBackground: true, preferCSSPageSize: true });
  await page.goto(pathToFileURL(resolve(root, 'index.html')).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  await page.screenshot({ path: resolve(root, '.build/gallery-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
    throw new Error('Brand gallery overflows on mobile.');
  }
  await page.screenshot({ path: resolve(root, '.build/gallery-mobile.png'), fullPage: true });
  if (failures.length) throw new Error(failures.join('\n'));
  await writeFile(resolve(root, '.build/browser-validation.json'), JSON.stringify({
    guidePages: 8, pngExports: jobs.length, mobileOverflow: false, pageErrors: failures,
  }, null, 2));
  console.log('Created PDF; verified guide images and gallery at desktop and mobile widths.');
} finally {
  await browser.close();
}
