import type { Page } from 'playwright';
import { Solver } from '@2captcha/captcha-solver';
import { readFileSync } from "fs";

export interface TurnstileOptions {
  apiKey: string;
  siteKeySelector?: string; // defaults to .cf-turnstile
  pageUrl?: string; // defaults to page.url()
  initialWaitSec?: number; // default 12s
  pollingIntervalSec?: number; // default 5s
  timeoutSec?: number; // default 120s
  verbose?: boolean; // extra logging
  useLibraryFirst?: boolean; // try official library first (default true)
}

export interface SolveResult {
  token: string;
  sitekey: string;
  params?: {
    action?: string;
    cData?: string;
    chlPageData?: string;
  };
  attempt?: number;
}

// Custom error to allow caller to distinguish retryable vs fatal 2Captcha issues
export class CaptchaSolveError extends Error {
  constructor(message: string, public code?: string, public retryable: boolean = false) {
    super(message);
    this.name = 'CaptchaSolveError';
  }
}

export async function injectTurnstileScript(page: Page) {
  const preloadFile = readFileSync("./playwright-2captcha/utils/cloudflare-turnstile/inject.js", "utf8");
  await page.addInitScript({ content: preloadFile });
}

export async function loadPageAndSolveTurnstile(page: Page, url: string) {
    const apiKey = process.env.TWO_CAPTCHA_KEY;
    if (!apiKey) {
        throw new Error('Missing TWO_CAPTCHA_KEY in environment. Create a .env file with TWO_CAPTCHA_KEY=your_key');
    }
    const solver = new Solver(apiKey);

  // Here we intercept the console messages to catch the message logged by inject.js script
    page.on("console", async (msg) => {
      const txt = msg.text();
      if (txt.includes("intercepted-params:")) {
        const params = JSON.parse(txt.replace("intercepted-params:", ""));
        console.log(params);

        try {
          console.log(`Solving the captcha...`);
          const res = await solver.cloudflareTurnstile(params);
          console.log(`Solved the captcha ${res.id}`);
          console.log(res);
          await page.evaluate((token) => {
            //@ts-ignore
            cfCallback(token);
          }, res.data);
        } catch (e) {
          console.log('Error while solving the captcha:', e);
          return process.exit();
        }
    } else {
      return;
    }
  });
  await page.goto(url);
}

// We now rely on @2captcha/captcha-solver library instead of manual HTTP calls.

export async function installTurnstileHook(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    if (w.__turnstileHookInit) return;
    w.__turnstileHookInit = true;
    w.__turnstileCaptured = [];
    const attemptInstall = () => {
      if (!w.turnstile || typeof w.turnstile.render !== 'function') {
        requestAnimationFrame(attemptInstall);
        return;
      }
      if (w.__turnstilePatched) return;
      w.__turnstilePatched = true;
      const orig = w.turnstile.render.bind(w.turnstile);
      w.turnstile.render = (...args: any[]) => {
        try {
          const cfg = args[1] || {};
          // Attempt to get a widget id (turnstile.render returns id; we capture after original call too)
          const entry: any = {
            sitekey: cfg.sitekey,
            action: cfg.action,
            cData: cfg.cData,
            chlPageData: cfg.chlPageData,
            callback: cfg.callback,
            ts: Date.now(),
          };
          if (typeof cfg.callback === 'function') {
            w.cfCallback = cfg.callback;
          }
          w.__turnstileCaptured.push(entry);
        } catch {}
        const result = orig(...args);
        try {
          if (w.__turnstileCaptured.length) {
            const last = w.__turnstileCaptured[w.__turnstileCaptured.length - 1];
            last.widgetId = result;
          }
        } catch {}
        return result;
      };
    };
    attemptInstall();
  });
}

const IN_URL = 'https://2captcha.com/in.php';
const RES_URL = 'https://2captcha.com/res.php';

export async function solveTurnstile(page: Page, opts: TurnstileOptions): Promise<SolveResult> {
  const {
    apiKey,
    siteKeySelector = '.cf-turnstile',
    pageUrl,
    initialWaitSec = 12,
    pollingIntervalSec = 5,
    timeoutSec = 120,
    verbose = false,
  } = opts;

  if (!apiKey) throw new Error('TWO_CAPTCHA_KEY is required');

  // 1) Extract sitekey (robust DOM / frame inspection inspired by the 2Captcha demo)
  const sitekey = await detectSitekey(page, {
    preferredSelector: siteKeySelector,
    timeoutMs: 45000,
  });

  if (!sitekey) {
    throw new Error('Unable to find Turnstile data-sitekey on the page');
  }

  if (verbose) console.log(`🔑 Found Turnstile sitekey: ${sitekey}`);

  // Attempt to pull captured render params (action, cData, chlPageData)
  const captured = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const last = Array.isArray(w.__turnstileCaptured) ? w.__turnstileCaptured[w.__turnstileCaptured.length - 1] : w.__turnstileInterceptedParams;
    return last || null;
  });
  if (verbose && captured) {
    console.log('🧪 Turnstile captured config:', {
      sitekey: captured.sitekey,
      action: captured.action,
      hasCData: Boolean(captured.cData),
      hasChlPageData: Boolean(captured.chlPageData),
      ts: captured.ts || Date.now()
    });
  }

  const targetUrl = pageUrl || page.url();

  // Use solver library
  const solver = new Solver(apiKey);
  if (verbose) {
    console.log('📤 2Captcha solver.cloudflareTurnstile() request (masked key)');
  }

  try {
    if (opts.useLibraryFirst !== false) {
      const res: any = await solver.cloudflareTurnstile({
        sitekey,
        pageurl: targetUrl,
        action: captured?.action,
        data: captured?.cData
      });
      if (verbose) {
        console.log('📥 Solver response keys:', Object.keys(res));
        console.log('✅ Received Turnstile token from 2Captcha (library)');
      }
      const token = res?.data || res?.code || res?.token;
      if (!token) {
        throw new CaptchaSolveError('Solver returned no token', 'NO_TOKEN', true);
      }
      return { token, sitekey, params: captured ? { action: captured.action, cData: captured.cData, chlPageData: captured.chlPageData } : undefined };
    } else if (verbose) {
      console.log('ℹ️ useLibraryFirst=false; skipping library solver');
    }
  } catch (e: any) {
    const msg = e?.message || e?.err || String(e);
    const code = e?.code || (msg.includes('UNSOLVABLE') ? 'ERROR_CAPTCHA_UNSOLVABLE' : (msg.includes('Some parameters are missing') ? 'ERROR_BAD_PARAMETERS' : undefined));
    const retryable = /UNSOLVABLE|TIMEOUT|NETWORK|NO_TOKEN/i.test(msg);
    if (verbose) console.log(`⚠️ Library solve failed (${code || 'NO_CODE'}). msg='${msg}'. Falling back to manual HTTP flow.`);
    // Proceed to fallback
    try {
      return await manualTurnstileSolve({
        apiKey,
        sitekey,
        targetUrl,
        captured,
        verbose,
        initialWaitSec,
        pollingIntervalSec,
        timeoutSec
      });
    } catch (fb: any) {
      const fMsg = fb?.message || String(fb);
      if (verbose) console.log('❌ Manual fallback failed:', fMsg);
      throw (fb instanceof CaptchaSolveError ? fb : new CaptchaSolveError(fMsg, undefined, /UNSOLVABLE|TIMEOUT|NETWORK/i.test(fMsg)));
    }
  }
  // Should not reach here; throw explicit error
  throw new CaptchaSolveError('Unexpected failure: no solve result produced', 'NO_RESULT', true);
}

async function manualTurnstileSolve(params: {
  apiKey: string;
  sitekey: string;
  targetUrl: string;
  captured: any;
  verbose: boolean;
  initialWaitSec: number;
  pollingIntervalSec: number;
  timeoutSec: number;
}): Promise<SolveResult> {
  const { apiKey, sitekey, targetUrl, captured, verbose, initialWaitSec, pollingIntervalSec, timeoutSec } = params;
  const inParams = new URLSearchParams();
  inParams.set('key', apiKey);
  inParams.set('method', 'turnstile');
  inParams.set('sitekey', sitekey);
  inParams.set('pageurl', targetUrl);
  inParams.set('json', '1');
  if (captured?.action) inParams.set('action', captured.action);
  if (captured?.cData) inParams.set('data', captured.cData);
  if (captured?.chlPageData) inParams.set('pagedata', captured.chlPageData);

  if (verbose) {
    const logged = Array.from(inParams.entries()).map(([k, v]) => (k === 'key' ? [k, '***'] : [k, v]));
    console.log('📤 (Fallback) 2Captcha in.php payload (masked):', Object.fromEntries(logged));
  }

  const inResp = await fetch(IN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: inParams.toString(),
  });
  const inData: any = await inResp.json();
  if (verbose) console.log('📥 (Fallback) in.php response:', inData);
  if (inData.status !== 1 || !inData.request) {
    const code = inData.request || 'UNKNOWN_IN';
    const retryable = code === 'ERROR_CAPTCHA_UNSOLVABLE' || code === 'ERROR_NO_SLOT_AVAILABLE' || code === 'ERROR_NEW_CAPTCHA';
    throw new CaptchaSolveError(`2Captcha in.php error: ${code}`, code, retryable);
  }
  const requestId = inData.request as string;

  const started = Date.now();
  await delay(initialWaitSec * 1000);
  while (true) {
    if (Date.now() - started > timeoutSec * 1000) {
      throw new CaptchaSolveError('2Captcha polling timed out', 'TIMEOUT', true);
    }
    const resUrl = `${RES_URL}?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(requestId)}&json=1`;
    const resResp = await fetch(resUrl);
    const resData: any = await resResp.json();
    if (resData.status === 1 && resData.request) {
      const token = String(resData.request);
      if (verbose) console.log('✅ (Fallback) Received Turnstile token');
      return { token, sitekey, params: captured ? { action: captured.action, cData: captured.cData, chlPageData: captured.chlPageData } : undefined };
    }
    if (resData.request === 'CAPCHA_NOT_READY') {
      await delay(pollingIntervalSec * 1000);
      continue;
    }
    const code = resData.request || 'UNKNOWN_RES';
    const retryable = code === 'ERROR_CAPTCHA_UNSOLVABLE' || code === 'ERROR_NO_SLOT_AVAILABLE' || code === 'ERROR_NEW_CAPTCHA';
    throw new CaptchaSolveError(`2Captcha res.php error: ${code}`, code, retryable);
  }
}

async function detectSitekey(
  page: Page,
  { preferredSelector, timeoutMs }: { preferredSelector?: string; timeoutMs: number }
): Promise<string | null> {
  await page.evaluate(() => {
    const win = window as unknown as Record<string, any>;
    if (win.__turnstileHookInstalled) return;
    win.__turnstileHookInstalled = true;

    const installHook = () => {
      const w = window as unknown as Record<string, any>;
      if (!w.turnstile || typeof w.turnstile.render !== 'function') {
        setTimeout(installHook, 50);
        return;
      }

      if (w.__turnstileOriginalRender) return;
      const originalRender = w.turnstile.render.bind(w.turnstile);
      w.__turnstileOriginalRender = originalRender;

      w.turnstile.render = function (...args: unknown[]) {
        const config = (args[1] ?? {}) as Record<string, any>;
        if (config) {
          w.__turnstileInterceptedParams = {
            sitekey: config.sitekey,
            action: config.action,
            cData: config.cData,
            chlPageData: config.chlPageData,
            callback: config.callback,
          };
          if (typeof config.callback === 'function') {
            w.cfCallback = config.callback;
          }
        }
        return originalRender(...(args as [unknown, unknown]));
      };
    };

    installHook();
  });

  const selectors = Array.from(
    new Set(
      [
        preferredSelector,
        '.cf-turnstile',
        '[data-sitekey]',
        '[data-site-key]',
        '[data-siteKey]',
        'iframe[src*="challenges.cloudflare.com"][src*="turnstile"]'
      ].filter(
        (sel): sel is string => Boolean(sel)
      )
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

        const ds = el.dataset as Record<string, string | undefined> | undefined;
        if (ds) {
          for (const key of datasetKeys) {
            const val = ds[key];
            if (val) return val;
          }
        }
      }

      const w = window as unknown as Record<string, any>;
      if (w.__turnstileInterceptedParams?.sitekey) {
        return w.__turnstileInterceptedParams.sitekey as string;
      }

      for (const script of Array.from(document.querySelectorAll('script'))) {
        for (const attr of ['data-sitekey', 'data-site-key', 'data-siteKey']) {
          const val = script.getAttribute(attr);
          if (val) return val;
        }
        const text = script.textContent || '';
        const match = text.match(/['"]sitekey['"]\s*[:=]\s*['"]([^'"\s]+)['"]/i);
        if (match) return match[1];
      }

      // Iframe src attribute inspection (may contain sitekey as a path segment)
      const iframeCandidates = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
      for (const iframe of iframeCandidates) {
        const src = iframe.getAttribute('src') || '';
        if (!src.includes('challenges.cloudflare.com')) continue;
        // Look for a 0x-prefixed sitekey segment
        const segMatch = src.match(/(0x[a-zA-Z0-9]{10,})/);
        if (segMatch) return segMatch[1];
        // Also try query params-like pattern k= or sitekey=
        const qpMatch = src.match(/[?&](?:k|sitekey)=([^&]+)/i);
        if (qpMatch) return decodeURIComponent(qpMatch[1]);
      }

      const html = document.documentElement?.outerHTML || '';
      const inlineMatch = html.match(/['"]sitekey['"]\s*[:=]\s*['"]([^'"\s]+)['"]/i);
      if (inlineMatch) return inlineMatch[1];

      return null;
    }, selectors);
  };

  const readFromFrames = (): string | null => {
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === 'about:blank') continue;
      if (!frameUrl.includes('turnstile') && !frameUrl.includes('challenges.cloudflare.com')) continue;

      try {
        const url = new URL(frameUrl);
        const directKey = url.searchParams.get('k') || url.searchParams.get('sitekey') || url.searchParams.get('siteKey');
        if (directKey) return directKey;
        // Inspect path segments for 0x-prefixed sitekey
        const segs = url.pathname.split('/').filter(Boolean);
        for (const seg of segs) {
          if (/^0x[a-zA-Z0-9]{10,}$/.test(seg)) return seg;
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

export async function injectTurnstileToken(
  page: Page,
  token: string,
  inputSelector: string = 'input[name="cf-turnstile-response"]',
  formSelector: string = 'form#remove',
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log('🧩 Injecting Turnstile token...');
  const result = await page.evaluate(({ inpSel, frmSel, val, v }) => {
    const logs: string[] = [];
    const w = window as unknown as Record<string, any>;
    const log = (m: string) => { if (v) logs.push(m); };

    let callbackInvoked = false;

    // 1) Direct known callback
    try {
      if (typeof w.cfCallback === 'function') {
        w.cfCallback(val);
        callbackInvoked = true;
        log('Called w.cfCallback');
      }
    } catch (e) { log('w.cfCallback invocation failed'); }

    // 2) Try last captured render config callback
    if (!callbackInvoked) {
      try {
        const captured = w.__turnstileCaptured;
        if (Array.isArray(captured) && captured.length) {
          const last = captured[captured.length - 1];
          if (last && typeof last.callback === 'function') {
            last.callback(val);
            callbackInvoked = true;
            log('Called last captured callback');
          }
        }
      } catch { log('Captured callback attempt failed'); }
    }

    // 3) data-callback attribute on widget
    if (!callbackInvoked) {
      try {
        const widget = document.querySelector('.cf-turnstile') as HTMLElement | null;
        const cbName = widget?.getAttribute('data-callback');
        if (cbName && typeof (w as any)[cbName] === 'function') {
          (w as any)[cbName](val);
          callbackInvoked = true;
          log(`Called data-callback function ${cbName}`);
        }
      } catch { log('data-callback attempt failed'); }
    }

    // 4) Hidden input injection
    try {
      let input = document.querySelector<HTMLInputElement>(inpSel);
      if (!input) {
        const form = document.querySelector(frmSel) || document.querySelector('form');
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'cf-turnstile-response';
        form?.appendChild(input);
        log('Created hidden response input');
      }
      if (input) {
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        log('Set hidden input value & dispatched events');
      }
    } catch { log('Hidden input injection failed'); }

    // 5) Emit a custom event some apps listen for
    try {
      const ev = new CustomEvent('turnstile-token-injected', { detail: { token: val } });
      window.dispatchEvent(ev);
      log('Dispatched custom event turnstile-token-injected');
    } catch { log('Custom event dispatch failed'); }

    return { callbackInvoked, logs };
  }, { inpSel: inputSelector, frmSel: formSelector, val: token, v: verbose });

  if (verbose) {
    console.log('🧩 Injection result:', result);
    if (!result.callbackInvoked) {
      console.log('⚠️ No Turnstile callback function was invoked; relying on hidden input.');
    }
  }
}

// Utility to verify whether a token seems to have been accepted by the widget/form.
// Heuristics only: checks hidden input value and absence of busy state.
export async function verifyTurnstileTokenAccepted(page: Page, {
  inputSelector = 'input[name="cf-turnstile-response"]',
  timeoutMs = 8000,
  verbose = false
}: { inputSelector?: string; timeoutMs?: number; verbose?: boolean } = {}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate((sel) => {
      const input = document.querySelector<HTMLInputElement>(sel);
      if (!input || !input.value || input.value.length < 20) return false;
      // Try to detect widget success markers
      const widget = document.querySelector('.cf-turnstile');
      if (widget) {
        const ariaBusy = widget.getAttribute('aria-busy');
        if (ariaBusy === 'false') return true;
      }
      return true; // If value is present we optimistically assume success
    }, inputSelector);
    if (ok) return true;
    await page.waitForTimeout(400);
  }
  if (verbose) console.log('⚠️ verifyTurnstileTokenAccepted timed out without confirmation');
  return false;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
