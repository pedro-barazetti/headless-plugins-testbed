import { chromium, Page } from 'playwright';
import { isFoundReCaptchaBadge } from './utils/isFoundReCaptchaBadge';
import { isFoundRecaptchaChallengeFrame } from './utils/isFoundRecaptchaChallengeFrame';
import { captchaSolver, captchaSolverEnterprise } from './captchaSolver';
import { readFileSync } from 'fs';

const sleep = (time: number) => new Promise(resolve => setTimeout(resolve, time));

const recaptchaBadgeIframeSelector = 'iframe[title="reCAPTCHA"]';
const recaptchaCheckboxSelector = 'span.recaptcha-checkbox-unchecked';
const submitButtonSelector = '[data-action="demo_action"]';

// Optional shim for sites that reference a global `recaptcha()` function.
// When `shimRecaptcha` is true, we inject a no-op global function named `recaptcha`
// to avoid "ReferenceError: recaptcha is not defined" without interfering with
// Google reCAPTCHA behavior.
export async function solveRecaptchaEnterprise(page: Page, shimRecaptcha?: boolean): Promise<void> {
  console.log('8️⃣ Injecting reCAPTCHA client discovery script...');
  try {
    if (shimRecaptcha) {
      console.log('🛠️ Shimming missing global recaptcha() function...');
      // Ensure the shim is available both for already loaded document and future navigations/iframes
      await page.addInitScript(`
        (function(){
          try {
            if (typeof window.recaptcha !== 'function') {
              // define a no-op function on the global object
              Object.defineProperty(window, 'recaptcha', {
                value: function recaptcha() { /* no-op shim */ },
                writable: false,
                configurable: true,
                enumerable: false
              });
            }
            if (typeof globalThis.recaptcha !== 'function') {
              Object.defineProperty(globalThis, 'recaptcha', {
                value: function recaptcha() { /* no-op shim */ },
                writable: false,
                configurable: true,
                enumerable: false
              });
            }
          } catch (_) { /* ignore */ }
        })();
      `);

      // Also set it immediately for the current page context
      await page.evaluate(() => {
        try {
          // @ts-ignore
          if (typeof (window as any).recaptcha !== 'function') {
            // @ts-ignore
            (window as any).recaptcha = function recaptcha() { /* no-op shim */ };
          }
          // @ts-ignore
          if (typeof (globalThis as any).recaptcha !== 'function') {
            // @ts-ignore
            (globalThis as any).recaptcha = function recaptcha() { /* no-op shim */ };
          }
        } catch { /* ignore */ }
      });
    }

    const preloadFile = readFileSync("./playwright_captcha/utils/recaptcha/findClients.js", "utf8");
    // Inject the function definition into the page if not already present
    await page.addScriptTag({ content: `if (!window.__findRecaptchaInjected) { window.__findRecaptchaInjected = true; ${preloadFile}; }` });
    const clients = await page.evaluate(() => {
      // @ts-ignore
      if (typeof findRecaptchaClients === 'function') {
        // @ts-ignore
        return findRecaptchaClients();
      }
      return [];
    });
    console.log('🔍 reCAPTCHA clients detected:', JSON.stringify(clients, null, 2));
    const result = await captchaSolverEnterprise(page, clients[0]);
    // Inject the token into the appropriate textarea
    await page.evaluate((token: string) => {
        const textarea = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement;
        if (textarea) {
            textarea.value = token;
        }
    }, result?.data);
    return;
  } catch (error) {
    console.log('❌ Failed to inject/find reCAPTCHA clients:', error);
  }
}

export async function solveRecaptcha(page: Page, selector: string = recaptchaBadgeIframeSelector): Promise<void> {
  await page.waitForSelector(selector, { timeout: 30000 });
  await sleep(5000);

  const isFoundReCaptcha = await isFoundReCaptchaBadge(page);
  if(!isFoundReCaptcha) throw new Error('reCAPTCHA Badge not found!');
  console.log('reCAPTCHA Badge is found.');

  const iframeElementHandle = await page.$(recaptchaBadgeIframeSelector);
  const recaptchaBadgeIframe = await iframeElementHandle?.contentFrame();

  if(recaptchaBadgeIframe){
    await recaptchaBadgeIframe.evaluate((selector: string) => {
      const recaptchaCheckbox = document.querySelector<HTMLElement>(selector);
      recaptchaCheckbox?.click();
    }, recaptchaCheckboxSelector);

    await sleep(5000);

    const isRecaptchaChallengeShow = await isFoundRecaptchaChallengeFrame(page);
    if(isRecaptchaChallengeShow){
      console.log('reCAPTCHA iframe found!');
      const isCaptchaSolved = await captchaSolver(page);
      if(isCaptchaSolved){
        console.log('✅ The captcha has been successfully passed.');
      } else {
        console.log('ERROR_CAPTCHA_UNSOLVABLE');
      }
    } else {
      console.log('The captcha frame was NOT FOUND');
      await sleep(5000);
      return;
    }
  } else {
    throw new Error('reCAPTCHA Badge frame not found!');
  }

  await page.click(submitButtonSelector);
  await sleep(5000);
}
