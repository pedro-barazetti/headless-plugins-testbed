import 'dotenv/config';
import { chromium, Browser, Page } from 'playwright';
import { solveHCaptcha } from './index';

async function run() {
	const url = 'https://accounts.hcaptcha.com/demo';

	let browser: Browser | undefined;
	try {
		browser = await chromium.launch({ headless: false, slowMo: 50 });
		const ctx = await browser.newContext();
		const page: Page = await ctx.newPage();

		console.log(`Navigating to: ${url}`);
		await page.goto(url, { waitUntil: 'domcontentloaded' });

		// Solve and inject hCaptcha using 2Captcha
		const { sitekey } = await solveHCaptcha(page, { verbose: true });
		console.log(`Solved hCaptcha for sitekey: ${sitekey}`);

		// Click the demo submit button
		await page.waitForSelector('#hcaptcha-demo-submit', { state: 'visible', timeout: 15000 });
		await page.click('#hcaptcha-demo-submit');
		console.log('Submitted the form. Waiting for result…');

		// Optional: wait briefly to observe the result on the page
		await page.waitForTimeout(5000);
	} catch (err) {
		console.error('Error during hCaptcha demo run:', err);
		process.exitCode = 1;
	} finally {
		if (browser) {
			try { await browser.close(); } catch {}
		}
	}
}

run();

