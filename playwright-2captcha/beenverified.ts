import 'dotenv/config';
//@ts-ignore
import { chromium, Browser, Page, BrowserContext } from 'zyte-smartproxy-playwright';
import { normalizeUserAgent } from './utils/normalizeUserAgent';
import { injectTurnstileScript, loadPageAndSolveTurnstile } from './utils/cloudflare-turnstile/turnstile';
import { solveHCaptcha } from './utils/hcaptcha';

interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  city: string;
  state: string;
  zipCode: string;
}

class BeenVerifiedOptout {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch() {
    console.log('🚀 Starting Beenverified Opt-Out process...');
    
    const apiKey = process.env.SPM_API_KEY;
    if (!apiKey) {
      throw new Error('Missing API_KEY in environment. Create a .env file with API_KEY=your_key');
    }

    this.browser = await chromium.launch({
      spm_apikey: apiKey,
      spm_host: 'http://proxy.zyte.com:8011',
      headless: false,
      devtools: false,
      slowMo: 100,
      static_bypass: true, //  enable to save bandwidth (but may break some websites)
      block_ads: false, //  enable to save bandwidth (but may break some websites)
    });
    
    const normalizedUA = await normalizeUserAgent();  // Normalize User-Agent (Optional but recommended)
    this.context = await this.browser.newContext({ 
      viewport: { width: 1280, height: 720 },
      userAgent: normalizedUA,
    });
    this.page = await this.context.newPage();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async fillOptoutForm(pii: PersonalInfo) {
    if (!this.page) throw new Error('Page not initialized');

    console.log('📍 Injecting capture script...');
    await injectTurnstileScript(this.page);

    console.log('1️⃣ Navigating to Beenverified opt-out page...');
    await loadPageAndSolveTurnstile(this.page, 'https://www.beenverified.com/svc/optout/search/comprehensive_optouts');

    await this.page.waitForSelector('//*[@id="fname"]', { timeout: 80000 });

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="fname"]').fill(pii.firstName);

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="ln"]').fill(pii.lastName);

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="requestor_email"]').fill(pii.email);

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="age"]').fill(pii.age.toString());

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="street"]').fill('1 main st');

    await this.page.keyboard.press('Tab');
    await this.page.locator('//*[@id="city"]').fill(pii.city);

    await this.page.keyboard.press('Tab');
    await this.page.locator('//input[@name="state"]').fill(pii.state);

    await this.page.locator('//*[@id="zip"]').click();
    await this.page.locator('//*[@id="zip"]').fill(pii.zipCode);

    await this.page.waitForTimeout(2000);

    await this.page.locator('//form[@id="comprehensive-form"]/div/button').click();
  }

  async selectFirstResultAndOptout() {
    if (!this.page) throw new Error('Page not initialized');

    const xpath = '//div[contains(@class, "MuiGrid-grid-md-9")]//div[contains(@class, "MuiCard-root")]';
    await this.page.waitForSelector(`xpath=${xpath}`, { timeout: 65000 });

    await this.page.waitForTimeout(2000);

    const firstResult = this.page.locator(`xpath=${xpath}`).first();
    const resultCount = await this.page.locator(`xpath=${xpath}`).count();

    if (resultCount === 0) {
      throw new Error('No matching search results found');
    }

    await firstResult.click();   

    await this.page.waitForSelector('//form[@id="additional-fields-form"]//input[contains(@class,"PrivateSwitchBase-input")]', { timeout: 65000 });

    await this.page.locator('//form[@id="additional-fields-form"]//input[contains(@class,"PrivateSwitchBase-input")]').click();

    try {
      console.log('🧩 hCaptcha detected (phase: submit). Solving…');
      await solveHCaptcha(this.page, { verbose: true });
      await this.page.waitForTimeout(10000);
    } catch (e) {
      console.log('❌ hCaptcha solve failed (submit):', e);
    }

    console.log('Submitting opt-out request...');
    await this.page.locator('//button[text()="Remove my Info"]').click();

    console.log('⏳ Waiting for confirmation message...');
    const successVisible = await this.page.locator('//*[text()[contains(., "Your optout request was submitted")]]').isVisible({ timeout: 30000 }).catch(() => false);

    if (successVisible) {
      await this.page.screenshot({ path: 'beenverified-success.png', fullPage: true });
      return true;
    }

    const robotCheckVisible = await this.page.locator('//*[text()[contains(., "Please check that you are not a robot")]]').isVisible({ timeout: 30000 }).catch(() => false);

    if (robotCheckVisible) {
      await this.page.screenshot({ path: 'beenverified-robot-detected.png', fullPage: true });
      return false;
    }

    await this.page.screenshot({ path: 'beenverified-unknown-error.png', fullPage: true });
    return false;
  }

  async run(pii: PersonalInfo) {
    try {
      await this.launch();
      await this.fillOptoutForm(pii);
      const success = await this.selectFirstResultAndOptout();

      await this.page?.waitForTimeout(3000);

      return success;
    } catch (error) {
      console.error('Error during opt-out process:', error);
      if (this.page) {
        await this.page.screenshot({ path: 'beenverified-error.png', fullPage: true });
      }
      throw error;
    } finally {
      await this.close();
    }
  }
}

async function main() {
  const personalInfo: PersonalInfo = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe.12345@example.com',
    age: 35,
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94102',
  };

  const optout = new BeenVerifiedOptout();
  const success = await optout.run(personalInfo);

  console.log(success ? 'Success' : 'Failed');
}

if (require.main === module) {
  main().catch(console.error);
}

export { BeenVerifiedOptout, PersonalInfo };