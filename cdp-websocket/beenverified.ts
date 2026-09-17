import type { Locator, Page } from 'playwright';
import {
  injectTurnstileScript,
  solveNextTurnstileChallenge,
} from '../playwright-2captcha/utils/cloudflare-turnstile/turnstile';
import {
  ZyteCdpSession,
  closeZyteCdp,
  connectToZyteCdp,
  detectCaptchaOrChallenge,
  envFlag,
  navigateWithCdp,
  saveScreenshot,
} from './zyteCdp';

const OPTOUT_URL =
  'https://www.beenverified.com/svc/optout/search/comprehensive_optouts';

interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export async function beenVerifiedCdpTest(): Promise<void> {
  let session: ZyteCdpSession | null = null;

  try {
    session = await connectToZyteCdp();
    const { page } = session;

    // CDP returns a regular Playwright Page, so the same init-script and
    // console-capture based 2Captcha integration can be reused here.
    await injectTurnstileScript(page);

    console.log(`Navigating to ${OPTOUT_URL}`);
    const response = await navigateWithCdp(page, OPTOUT_URL);
    console.log(`HTTP status: ${response?.status() ?? 'unknown'}`);
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    if (/access denied|sorry, you have been blocked|attention required/i.test(pageTitle)) {
      await saveScreenshot(page, 'beenverified-access-denied.png').catch(() => undefined);
      throw new Error(
        'Cloudflare returned a hard access-denied page, not a Turnstile challenge; no challenge parameters are available for 2Captcha',
      );
    }

    const firstName = page.locator('#fname');
    let formAvailable = await firstName.isVisible({ timeout: 20_000 }).catch(() => false);
    const initialChallenge = await detectCaptchaOrChallenge(page);

    if (!formAvailable) {
      if (response?.status() === 403) initialChallenge.indicators.push('HTTP 403');
      if (/just a moment/i.test(await page.title())) {
        initialChallenge.indicators.push('Cloudflare interstitial');
      }
      initialChallenge.detected = initialChallenge.indicators.length > 0;
      initialChallenge.indicators = [...new Set(initialChallenge.indicators)];

      if (initialChallenge.detected) {
        console.log(
          `Solving initial Cloudflare challenge: ${initialChallenge.indicators.join(', ')}`,
        );
        try {
          await solveNextTurnstileChallenge(page, {
            timeoutMs: 45_000,
            verbose: true,
          });
        } catch (error) {
          await saveScreenshot(page, 'beenverified-blocked.png').catch(() => undefined);
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Could not solve the initial Cloudflare challenge: ${message}`);
        }

        formAvailable = await firstName
          .isVisible({ timeout: 45_000 })
          .catch(() => false);
      }

      if (!formAvailable) {
        await saveScreenshot(page, 'beenverified-blocked.png');
        throw new Error('BeenVerified search form was not found after Cloudflare handling');
      }

      console.log('Initial Cloudflare challenge passed; BeenVerified form is available.');
    }

    const pii = personalInfoFromEnvironment();
    await selectGuestRequestor(page);
    await fillIfVisible(page, '#fname', pii.firstName);
    await fillIfVisible(page, '#ln', pii.lastName);
    await fillIfVisible(page, '#requestor_email', pii.email);
    await fillIfVisible(page, '#age', pii.age);
    await fillIfVisible(page, '#street', pii.street);
    await fillIfVisible(page, '#city', pii.city);
    await fillIfVisible(page, 'input[name="state"]', pii.state);
    await fillIfVisible(page, '#zip', pii.zipCode);

    if (!envFlag('BEENVERIFIED_SUBMIT_SEARCH')) {
      await saveScreenshot(page, 'beenverified-ready.png');
      console.log(
        'CDP connection and BeenVerified form filling passed. Search submission was skipped; set BEENVERIFIED_SUBMIT_SEARCH=true to solve the form Turnstile and continue.',
      );
      return;
    }

    const submitButton = page.locator('#comprehensive-form button[type="submit"], #comprehensive-form button').first();
    if (!(await submitButton.isVisible({ timeout: 10_000 }).catch(() => false))) {
      throw new Error('BeenVerified search submit button was not found');
    }

    console.log('Solving the Cloudflare Turnstile check before Continue...');
    await solveNextTurnstileChallenge(page, {
      timeoutMs: 45_000,
      verbose: true,
    });
    await saveScreenshot(page, 'beenverified-turnstile-solved.png');

    console.log('Submitting the BeenVerified search form...');
    await submitButton.click();
    await page.waitForTimeout(5_000);

    if (envFlag('BEENVERIFIED_STOP_AFTER_CONTINUE')) {
      await saveScreenshot(page, 'beenverified-after-continue.png');
      console.log('Continue completed; stopped before interacting with any search result.');
      return;
    }

    const challenge = await detectCaptchaOrChallenge(page);
    if (challenge.detected) {
      await saveScreenshot(page, 'beenverified-captcha.png');
      throw new Error(
        `A CAPTCHA or challenge remained after Turnstile solving: ${challenge.indicators.join(', ')}`,
      );
    }

    const resultCards = page.locator(
      'div[class*="MuiGrid-grid-md-9"] div[class*="MuiCard-root"]',
    );
    const resultsVisible = await resultCards
      .first()
      .isVisible({ timeout: 30_000 })
      .catch(() => false);
    if (!resultsVisible) {
      const robotError = await page
        .getByText(/please check that you are not a robot/i)
        .first()
        .isVisible()
        .catch(() => false);
      await saveScreenshot(page, 'beenverified-no-results.png');
      throw new Error(
        robotError
          ? 'BeenVerified rejected the injected Cloudflare token'
          : 'No BeenVerified result cards appeared after Continue',
      );
    }

    console.log(`Result cards found: ${await resultCards.count()}`);
    await saveScreenshot(page, 'beenverified-after-search.png');
  } finally {
    await closeZyteCdp(session);
  }
}

async function selectGuestRequestor(page: Page): Promise<void> {
  console.log('Selecting "No, I do not"...');
  const guestOption = page
    .locator('li[role="option"][data-value="guest"]')
    .filter({ hasText: 'No, I do not' });
  const dropdowns = page.locator(
    '[role="combobox"][aria-haspopup="listbox"], [aria-haspopup="listbox"]',
  );

  await dropdowns.first().waitFor({ state: 'visible', timeout: 30_000 });
  const count = await dropdowns.count();
  for (let index = 0; index < count; index += 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) continue;

    await dropdown.click();
    if (await guestOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await guestOption.click();
      console.log('Selected "No, I do not".');
      return;
    }
    await page.keyboard.press('Escape');
  }

  throw new Error('Could not select the "No, I do not" guest option');
}

async function fillIfVisible(page: Page, selector: string, value: string): Promise<void> {
  const field: Locator = page.locator(selector).first();
  if (await field.isVisible().catch(() => false)) await field.fill(value);
}

function personalInfoFromEnvironment(): PersonalInfo {
  return {
    firstName: process.env.BEENVERIFIED_FIRST_NAME || 'John',
    lastName: process.env.BEENVERIFIED_LAST_NAME || 'Doe',
    email: process.env.BEENVERIFIED_EMAIL || 'john.doe.12345@example.com',
    age: process.env.BEENVERIFIED_AGE || '35',
    street: process.env.BEENVERIFIED_STREET || '1 Main St',
    city: process.env.BEENVERIFIED_CITY || 'San Francisco',
    state: process.env.BEENVERIFIED_STATE || 'CA',
    zipCode: process.env.BEENVERIFIED_ZIP || '94102',
  };
}

if (require.main === module) {
  beenVerifiedCdpTest().catch((error) => {
    console.error('BeenVerified CDP test failed:', error);
    process.exitCode = 1;
  });
}
