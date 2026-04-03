import type { Page, Route } from 'playwright';
import { Solver } from '@2captcha/captcha-solver';

export interface HCaptchaOptions {
	apiKey?: string; // defaults to process.env.TWO_CAPTCHA_KEY
	siteKeySelector?: string; // defaults to .h-captcha or [data-sitekey]
	pageUrl?: string; // defaults to page.url()
	verbose?: boolean; // extra logging
	/**
	 * Block POSTs to hCaptcha assets (https://newassets.hcaptcha.com/captcha/v1/) during solve.
	 * Useful when the page triggers challenge network calls that interfere with token injection.
	 */
	blockHCaptchaAssets?: boolean;
	/**
	 * Custom URL patterns to block during solve. If provided, overrides blockHCaptchaAssets default.
	 * Each entry can be a string prefix (startsWith match) or RegExp.
	 */
	blockedUrlPatterns?: Array<string | RegExp>;
	/**
	 * HTTP method to block for the patterns above. Defaults to 'POST'.
	 */
	blockedMethod?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
}

export interface HCaptchaSolveResult {
	token: string;
	sitekey: string;
}

/**
 * Optionally click the visible hCaptcha checkbox to mimic user behavior.
 */
export async function clickHCaptchaCheckbox(
	page: Page,
	{ timeoutMs = 15000, verbose = false }: { timeoutMs?: number; verbose?: boolean } = {}
): Promise<boolean> {
	const selCandidates = [
		'#captcha-widget iframe',
		'iframe[title*="hCaptcha"]',
		'iframe[data-hcaptcha-widget-id]',
		'iframe[src*="hcaptcha.com"][src*="checkbox"]',
		'iframe[src*="hcaptcha.com"]'
	];
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const sel of selCandidates) {
			const handle = await page.$(sel);
			if (!handle) continue;
			try {
				await handle.scrollIntoViewIfNeeded();
			} catch {}
			const frame = await handle.contentFrame();
			if (!frame) continue;
			try {
				// Try common selectors inside the checkbox frame
				const innerSelectors = [
					'div[role="checkbox"]',
					'#checkbox',
					'.checkbox',
					'.check',
					'.prompt-checkbox'
				];
				let clicked = false;
				for (const isel of innerSelectors) {
					const el = await frame.$(isel);
					if (el) {
						await el.click({ force: true });
						clicked = true;
						break;
					}
				}
				if (!clicked) {
					// Fallback: click near top-left within the frame body
					await frame.click('body', { position: { x: 40, y: 40 } });
					clicked = true;
				}
				if (verbose) console.log(`🖱️ Clicked hCaptcha checkbox via frame ${sel}`);
				return true;
			} catch (e) {
				if (verbose) console.log(`⚠️ Failed clicking inside frame ${sel}:`, (e as Error).message);
			}
		}
		await page.waitForTimeout(300);
	}
	if (verbose) console.log('ℹ️ hCaptcha checkbox frame not found or not clickable in time');
	return false;
}

/**
 * High-level helper: detect hCaptcha sitekey, solve via 2Captcha, and inject token into the page.
 */
export async function solveHCaptcha(page: Page, opts: HCaptchaOptions = {}): Promise<HCaptchaSolveResult> {
	const apiKey = opts.apiKey || process.env.TWO_CAPTCHA_KEY;
	if (!apiKey) {
		throw new Error('Missing TWO_CAPTCHA_KEY in environment. Create a .env file with TWO_CAPTCHA_KEY=your_key');
	}

	const sitekey = await detectHCaptchaSitekey(page, {
		preferredSelector: opts.siteKeySelector,
		timeoutMs: 45000,
		verbose: !!opts.verbose,
	});
	if (!sitekey) {
		throw new Error('Unable to find hCaptcha data-sitekey on the page');
	}
	if (opts.verbose) console.log(`🔑 Found hCaptcha sitekey: ${sitekey}`);

	// Optionally block disruptive network calls while solving/injecting
	let teardownRouting: null | (() => Promise<void>) = null;
	const shouldBlock = opts.blockedUrlPatterns?.length || opts.blockHCaptchaAssets;
	if (shouldBlock) {
		const patterns = opts.blockedUrlPatterns && opts.blockedUrlPatterns.length > 0
			? opts.blockedUrlPatterns
			: ['https://newassets.hcaptcha.com/captcha/v1/'];
		const method = opts.blockedMethod || 'POST';
		teardownRouting = await setupRequestBlockers(page, patterns, method, 'abort', !!opts.verbose);
	}

	// Try clicking the checkbox to mimic user flow (helps pages expecting interaction)
	//try {
	//	await clickHCaptchaCheckbox(page, { verbose: !!opts.verbose, timeoutMs: 8000 });
	//} catch {}

	const pageurl = opts.pageUrl || page.url();
	const solver = new Solver(apiKey);

	try {
		if (opts.verbose) console.log('📤 Requesting hCaptcha solution from 2Captcha…');
		const res: any = await solver.hcaptcha({
			sitekey,
			pageurl,
		});
		if (opts.verbose) console.log('📥 2Captcha response (hcaptcha):\n', res);

		const token = res?.data || res?.code || res?.token;
		if (!token) {
			throw new Error('2Captcha returned no token for hCaptcha');
		}

		if (opts.verbose) console.log('🧩 Injecting hCaptcha token…');
		await injectHCaptchaToken(page, token, opts.verbose);

		// Best-effort verification: confirm the textarea contains the token
		const ok = await verifyHCaptchaTokenAccepted(page, { verbose: opts.verbose });
		if (!ok && opts.verbose) console.log('⚠️ Unable to confirm token acceptance; proceeding anyway');

		return { token, sitekey };
	} finally {
		if (teardownRouting) {
			try { await teardownRouting(); } catch {}
		}
	}
}

/**
 * Try to detect hCaptcha sitekey from DOM/frames.
 */
async function detectHCaptchaSitekey(
	page: Page,
	{ preferredSelector, timeoutMs, verbose }: { preferredSelector?: string; timeoutMs: number; verbose?: boolean }
): Promise<string | null> {
	const selectors = Array.from(
		new Set(
			[
				preferredSelector,
				'.h-captcha',
				'#captcha-widget',
				'div[id*="captcha"][data-sitekey]',
				'div[data-callback][data-sitekey]',
				'[data-sitekey]',
				'[data-site-key]',
				'[data-siteKey]',
				'iframe[src*="hcaptcha.com"]',
				'iframe[title*="hCaptcha"]',
				'iframe[data-hcaptcha-widget-id]'
			].filter((s): s is string => Boolean(s))
		)
	);

	const deadline = Date.now() + timeoutMs;

	const readFromDom = async (): Promise<string | null> => {
		return page.evaluate((sels: string[]) => {
			const datasetKeys = ['sitekey', 'siteKey', 'site-key'];

			for (const selector of sels) {
				const el = document.querySelector(selector) as HTMLElement | null;
				if (!el) continue;

				for (const attr of ['data-sitekey', 'data-site-key', 'data-siteKey']) {
					const val = el.getAttribute(attr);
					if (val) return val;
				}

				// Heuristic: if we can locate the hcaptcha response field, try to find a nearby container with data-sitekey
				const responseField = document.querySelector('textarea[name="h-captcha-response"], input[name="h-captcha-response"]') as HTMLElement | null;
				if (responseField) {
					let cur: HTMLElement | null = responseField;
					for (let i = 0; i < 5 && cur; i++) {
						const val = cur.getAttribute?.('data-sitekey') || (cur as any).dataset?.sitekey;
						if (val) return val;
						cur = cur.parentElement;
					}
					// also check siblings like #captcha-widget
					const siblingWithKey = responseField.parentElement?.querySelector?.('#captcha-widget[data-sitekey], [data-callback][data-sitekey]') as HTMLElement | null;
					if (siblingWithKey) {
						const val = siblingWithKey.getAttribute('data-sitekey') || (siblingWithKey as any).dataset?.sitekey;
						if (val) return val;
					}
				}

				const ds = (el as any).dataset as Record<string, string | undefined> | undefined;
				if (ds) {
					for (const key of datasetKeys) {
						const val = ds[key];
						if (val) return val;
					}
				}
			}

			// Check scripts for inline sitekey usage
			for (const script of Array.from(document.querySelectorAll('script'))) {
				for (const attr of ['data-sitekey', 'data-site-key', 'data-siteKey']) {
					const val = script.getAttribute(attr);
					if (val) return val;
				}
				const text = script.textContent || '';
				const match = text.match(/["']sitekey["']\s*[:=]\s*["']([^"'\s]+)["']/i);
				if (match) return match[1];
			}

			// Inspect iframes with hcaptcha.com in src (parse both query and hash fragments)
			const iframeCandidates = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
			for (const iframe of iframeCandidates) {
				const src = iframe.getAttribute('src') || '';
				if (!src.includes('hcaptcha.com')) continue;
				// Try query params sitekey or k
				const qpMatch = src.match(/[?&](?:sitekey|k|siteKey)=([^&]+)/i);
				if (qpMatch) return decodeURIComponent(qpMatch[1]);
				// Try hash fragment params: #...&sitekey=...
				const hashIdx = src.indexOf('#');
				if (hashIdx >= 0) {
					const hash = src.slice(hashIdx + 1);
					const parts = new URLSearchParams(hash.replace(/^[#?]/, ''));
					const fromHash = parts.get('sitekey') || parts.get('siteKey') || parts.get('k');
					if (fromHash) return fromHash;
					// last resort: regex in hash
					const m = hash.match(/(?:^|&)(?:sitekey|siteKey|k)=([^&]+)/i);
					if (m) return decodeURIComponent(m[1]);
				}
			}

			const html = document.documentElement?.outerHTML || '';
			const inlineMatch = html.match(/["']sitekey["']\s*[:=]\s*["']([^"'\s]+)["']/i);
			if (inlineMatch) return inlineMatch[1];

			return null;
		}, selectors);
	};

	const readFromFrames = (): string | null => {
		for (const frame of page.frames()) {
			const frameUrl = frame.url();
			if (!frameUrl || frameUrl === 'about:blank') continue;
			if (!frameUrl.includes('hcaptcha.com')) continue;
			try {
				const url = new URL(frameUrl);
				const directKey = url.searchParams.get('sitekey') || url.searchParams.get('siteKey') || url.searchParams.get('k');
				if (directKey) return directKey;
				// Also parse hash fragment (hCaptcha often encodes params in the hash)
				if (url.hash) {
					const hash = url.hash.replace(/^#/, '');
					const hsp = new URLSearchParams(hash);
					const hashKey = hsp.get('sitekey') || hsp.get('siteKey') || hsp.get('k');
					if (hashKey) return hashKey;
					const m = hash.match(/(?:^|&)(?:sitekey|siteKey|k)=([^&]+)/i);
					if (m) return decodeURIComponent(m[1]);
				}
				// Also look in path segments for a plausible key
				const segs = url.pathname.split('/').filter(Boolean);
				for (const seg of segs) {
					if (/^\w{10,}$/.test(seg)) return seg; // heuristic only
				}
			} catch {
				continue;
			}
		}
		return null;
	};

	while (Date.now() < deadline) {
		try {
			const domKey = await readFromDom();
			if (domKey) return domKey;
		} catch {
			// ignore and continue polling
		}

		const frameKey = readFromFrames();
		if (frameKey) return frameKey;

		await page.waitForTimeout(500);
	}

	return null;
}

/**
 * Temporarily block matching network requests while solving/injecting.
 * - patterns: string (startsWith match) or RegExp evaluated against request.url()
 * - method: HTTP method to block (default 'POST')
 * - mode: abort request or fulfill with 204
 */
async function setupRequestBlockers(
	page: Page,
	patterns: Array<string | RegExp>,
	method: string = 'POST',
	mode: 'abort' | 'fulfill204' = 'abort',
	verbose: boolean = false
): Promise<() => Promise<void>> {
	const handlers: Array<{ matcher: string | RegExp; handler: (route: Route) => Promise<void> }> = [];

	for (const matcher of patterns) {
		const handler = async (route: Route) => {
			const req = route.request();
			const url = req.url();
			const m = req.method();

			// Match URL
			const urlMatches = typeof matcher === 'string' ? url.startsWith(matcher) : matcher.test(url);
			if (!urlMatches) return route.continue();

			// Match method if provided
			if (method && m.toUpperCase() !== method.toUpperCase()) {
				return route.continue();
			}

			if (verbose) console.log(`⛔ Blocking ${m} ${url}`);
			if (mode === 'abort') {
				return route.abort();
			}
			return route.fulfill({ status: 204, body: '' });
		};
		await page.route(matcher as any, handler);
		handlers.push({ matcher, handler });
	}

	return async () => {
		for (const { matcher, handler } of handlers) {
			try { await page.unroute(matcher as any, handler as any); } catch {}
		}
	};
}

/**
 * Inject the solved token into typical hCaptcha fields and attempt callback invocation.
 */
export async function injectHCaptchaToken(page: Page, token: string, verbose: boolean = false): Promise<void> {
	const result = await page.evaluate(({ val, v }) => {
		const logs: string[] = [];
		const log = (m: string) => { if (v) logs.push(m); };
		const w = window as unknown as Record<string, any>;

		let callbackInvoked = false;

		// Helper: set value and dispatch events on a single input
		const setInputValue = (el: HTMLInputElement, value: string) => {
			(el as any).value = value;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
		};

		// 1) Try data-callback on widget container and ensure expected attributes
		try {
			const widget = (document.querySelector('#captcha-widget') || document.querySelector('.h-captcha') || document.querySelector('[data-sitekey]')) as HTMLElement | null;
			const cbName = widget?.getAttribute('data-callback');
			if (cbName && typeof (w as any)[cbName] === 'function') {
				(w as any)[cbName](val);
				callbackInvoked = true;
				log(`Called data-callback function ${cbName}`);
			}
			// Ensure expected attribute present for page logic parity
			try {
				if (widget) {
					widget.setAttribute('bis_skin_checked', '1');
					log('Set #captcha-widget[bis_skin_checked="1"]');
				}
			} catch {}
		} catch { log('data-callback attempt failed'); }

		// 2) Set exactly two targets as per expected page structure:
		//    a) The hidden input[name="h-captcha-response"] outside the widget container
		//    b) The captcha iframe's data-hcaptcha-response attribute
		try {
			const widget = document.querySelector('#captcha-widget') as HTMLElement | null;

			// a) Hidden input (prefer sibling/parent of widget)
			let hiddenInput: HTMLInputElement | null = null;
			if (widget && widget.parentElement) {
				hiddenInput = widget.parentElement.querySelector('input[name="h-captcha-response"]');
			}
			if (!hiddenInput) {
				hiddenInput = document.querySelector('input[name="h-captcha-response"]');
			}
			// If still not found, create it right before the widget to match expected markup
			if (!hiddenInput && widget && widget.parentElement) {
				hiddenInput = document.createElement('input');
				hiddenInput.type = 'hidden';
				hiddenInput.name = 'h-captcha-response';
				try {
					widget.parentElement.insertBefore(hiddenInput, widget);
				} catch {
					document.body.appendChild(hiddenInput);
				}
				log('Created missing hidden input[name="h-captcha-response"] before widget');
			}
			if (hiddenInput) {
				setInputValue(hiddenInput, val);
				log('Set hidden input[name="h-captcha-response"]');
			} else {
				log('Hidden input[name="h-captcha-response"] not found and could not be created');
			}

			// b) iframe attribute inside widget (fallback to global if not found under widget)
			let iframe: HTMLIFrameElement | null = null;
			if (widget) {
				iframe = widget.querySelector('iframe[data-hcaptcha-widget-id], iframe[title*="hCaptcha"], iframe[src*="hcaptcha.com"]');
			}
			if (!iframe) {
				iframe = document.querySelector('iframe[data-hcaptcha-widget-id], iframe[title*="hCaptcha"], iframe[src*="hcaptcha.com"]');
			}
			if (iframe) {
				iframe.setAttribute('data-hcaptcha-response', val);
				try { (iframe as any).dataset.hcaptchaResponse = val; } catch {}
				log('Set iframe[data-hcaptcha-response]');
			} else {
				log('hCaptcha iframe not found for setting data-hcaptcha-response');
			}
		} catch { log('Hidden input/textarea injection failed'); }

		// 3) Emit a custom event some apps listen for
		try {
			const ev = new CustomEvent('hcaptcha-token-injected', { detail: { token: val } });
			window.dispatchEvent(ev);
			// Some apps listen to generic success events
			window.dispatchEvent(new CustomEvent('hcaptcha-success', { detail: { response: val } }));
			log('Dispatched custom events hcaptcha-token-injected & hcaptcha-success');
		} catch { log('Custom event dispatch failed'); }

		return { callbackInvoked, logs };
	}, { val: token, v: verbose });

	if (verbose) {
		console.log('🧩 hCaptcha injection result:', result);
		if (!result.callbackInvoked) {
			console.log('ℹ️ No hCaptcha callback function invoked; relying on hidden inputs.');
		}
	}
}

export async function verifyHCaptchaTokenAccepted(page: Page, {
	timeoutMs = 8000,
	verbose = false
}: { timeoutMs?: number; verbose?: boolean } = {}): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ok = await page.evaluate(() => {
			const vals: string[] = [];
			for (const sel of [
				'textarea[name="h-captcha-response"]',
				'input[name="h-captcha-response"]',
				'textarea[name="g-recaptcha-response"]',
				'input[name="g-recaptcha-response"]',
				'textarea[id^="h-captcha-response-"]',
				'input[id^="h-captcha-response-"]',
				'textarea[id^="g-recaptcha-response-"]',
				'input[id^="g-recaptcha-response-"]'
			]) {
				const nodes = Array.from(document.querySelectorAll(sel)) as (HTMLInputElement | HTMLTextAreaElement)[];
				for (const n of nodes) {
					if (n && (n as any).value) vals.push((n as any).value);
				}
			}
			// Also check iframe attribute
			const iframe = document.querySelector('iframe[data-hcaptcha-widget-id], iframe[title*="hCaptcha"], iframe[src*="hcaptcha.com"]') as HTMLIFrameElement | null;
			const iframeVal = iframe?.getAttribute('data-hcaptcha-response') || '';
			if (iframeVal) vals.push(iframeVal);
			return vals.some(v => v && v.length > 20);
		});
		if (ok) return true;
		await page.waitForTimeout(400);
	}
	if (verbose) console.log('⚠️ verifyHCaptchaTokenAccepted timed out without confirmation');
	return false;
}

