import { chromium } from 'playwright';

/**
 * Launches a temporary headless browser to obtain a realistic (non-Headless) UA string.
 * Falls back to a static modern Chrome UA if anything fails.
 */
export async function normalizeUserAgent(): Promise<string> {
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    await browser.close();
    return ua
      .replace(/Headless\s?/i, '')
      .replace(/Chromium/i, 'Chrome');
  } catch {
    // Fallback UA (close to current stable Chrome on Win10 x64)
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  }
}

export default normalizeUserAgent;