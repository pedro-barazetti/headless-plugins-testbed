import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import SmartProxyPlugin from 'zyte-smartproxy-plugin';

const URL = 'https://www.j-platpat.inpit.go.jp/?uri=/p0000';
//const URL = 'https://www.j-platpat.inpit.go.jp/p0000';
//const URL = 'https://www.j-platpat.inpit.go.jp/s0100';

async function main() {
	const apiKey = process.env.API_KEY;
	if (!apiKey) {
		throw new Error('Missing API_KEY in environment. Create a .env file with API_KEY=your_key');
	}

	// Add stealth to reduce fingerprinting
	puppeteer.use(StealthPlugin());
	// Integrate Zyte Smart Proxy plugin
	puppeteer.use(
		SmartProxyPlugin ({
			spm_apikey: apiKey,
            spm_host: 'http://api.zyte.com:8011',
            headers: { 
                'X-Crawlera-No-Bancheck': '1', 
                'X-Crawlera-Profile': 'pass', 
                'X-Crawlera-Cookies': 'disable'             
            },
            static_bypass: false
		})
	);

	const browser = await puppeteer.launch({
		headless: false,
		devtools: true,
		// SlowMo can help with tricky pages; leave commented by default
		slowMo: 25,
		defaultViewport: { width: 1600, height: 900 },
	});

	try {
		const page = await browser.newPage();

		// Optional: modest user agent normalization to look like Chrome
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		);

		// Navigate and wait until network is relatively idle
		await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

		// Some sites render async after network idle; add a short wait

		// Ensure banner element exists to confirm page loaded
		await page.waitForSelector('#cfc001_header_lnkJppBanner', { timeout: 60000 });

		// Take a full-page screenshot
		const screenshotPath = 'platpat.png';
		await page.screenshot({ path: screenshotPath, fullPage: true });

		console.log(`Screenshot saved to ${screenshotPath}`);
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error('Error running platpat screenshot script:', err);
	process.exitCode = 1;
});

