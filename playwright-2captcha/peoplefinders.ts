import 'dotenv/config';
//@ts-ignore
import { chromium, Browser, Page } from 'zyte-smartproxy-playwright';
import { normalizeUserAgent } from './utils/normalizeUserAgent';
import { injectTurnstileScript, loadPageAndSolveTurnstile } from './utils/cloudflare-turnstile/turnstile';
import { solveRecaptchaEnterprise } from './utils/recaptcha';

function getErrMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function peopleFinderOptOut() {
  let browser: Browser | null = null;
  
  try {
    console.log('🚀 Starting PeopleFinder Opt-Out process...');
    
    const apiKey = process.env.SPM_API_KEY;
    if (!apiKey) {
      throw new Error('Missing SPM_API_KEY in environment. Create a .env file with SPM_API_KEY=your_key');
    }

    const normalizedUA = await normalizeUserAgent();
    browser = await chromium.launch({ 
      spm_apikey: apiKey,
      spm_host: 'http://proxy.zyte.com:8011',
      headless: false, 
      slowMo: 1000,
      static_bypass: false, //  enable to save bandwidth (but may break some websites)
      block_ads: false, //  enable to save bandwidth (but may break some websites)
      // args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
    });
  
    const context = await browser.newContext({ userAgent: normalizedUA });
    const page = await context.newPage();
    
    // Hardcoded PII data
    const userData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe.test@example.com'
    };
    
    // 1. Solve Captcha (Cloudflare Turnstile)
    console.log('📍 Injecting capture script...');
    await injectTurnstileScript(page);

    console.log('1️⃣ Navigating to PeopleFinder opt-out page...');
    await loadPageAndSolveTurnstile(page, 'https://www.peoplefinders.com/opt-out');

    // 2. Click opt-out button
    console.log('2️⃣ Clicking opt-out button...');
    try {
      await page.click('//div[contains(@class, "body-area-one-page")]//button[contains(@class, "opt-out-button")]', { timeout: 45000 });
      console.log('✅ Opt-out button clicked');
    } catch (error) {
      console.log('❌ Failed to click opt-out button:', getErrMsg(error));
    }    

    // 3. Wait for form fields
    console.log('3️⃣ Waiting for form fields...');
    try {
      await page.waitForSelector('//*[@placeholder="First Name"]', { timeout: 30000 });
      console.log('✅ Form fields loaded');
    } catch (error) {
      console.log('❌ Form fields not found:', getErrMsg(error));
    }
    
    // 4. Fill first name
    console.log('4️⃣ Filling first name...');
    try {
      await page.fill('//*[@placeholder="First Name"]', userData.firstName);
      console.log('✅ First name filled');
    } catch (error) {
      console.log('❌ Failed to fill first name:', getErrMsg(error));
    }
    
    // 5. Fill last name
    console.log('5️⃣ Filling last name...');
    try {
      await page.fill('//*[@placeholder="Last Name"]', userData.lastName);
      console.log('✅ Last name filled');
    } catch (error) {
      console.log('❌ Failed to fill last name:', getErrMsg(error));
    }
    
    // 6. Fill email
    console.log('6️⃣ Filling email...');
    try {
      await page.fill('//*[@placeholder="Email"]', userData.email);
      console.log('✅ Email filled');
    } catch (error) {
      console.log('❌ Failed to fill email:', getErrMsg(error));
    }
    
    // 7. Check terms checkbox
    console.log('7️⃣ Checking terms checkbox...');
    try {
      await page.click('//form/div[@class="terms-wrapper"]/input');
      console.log('✅ Terms checkbox checked');
    } catch (error) {
      console.log('❌ Failed to check terms checkbox:', getErrMsg(error));
    }
    
    // 8. Solve CAPTCHA again (ReCaptcha)
    console.log('8️⃣ Submitting form... (1st time)');  // to trigger CAPTCHA
    try {
      await page.click('//form//button[contains(@class, "btn-primary")]');
      console.log('✅ Form submitted');
    } catch (error) {
      console.log('❌ Failed to submit form:', getErrMsg(error));
    }
    await solveRecaptchaEnterprise(page);
    console.log('⏳ Waiting 3 seconds after CAPTCHA solve...');
    await page.waitForTimeout(3000);

    
    // 9. Submit form
    console.log('9️⃣ Submitting form... (2nd time)');
    try {
      await page.click('//form//button[contains(@class, "btn-primary")]');
      console.log('✅ Form submitted');
    } catch (error) {
      console.log('❌ Failed to submit form:', getErrMsg(error));
    }
    
    // 10. Check for confirmation message
    console.log('🔟 Waiting for confirmation message...');
    try {
      await page.waitForSelector('//*[text()[contains(., "email has been sent")]]', { timeout: 60000 });
      console.log('✅ SUCCESS! Confirmation message found: "email has been sent"');
      
      // Take success screenshot
      await page.screenshot({ path: 'peoplefinder-success.png', fullPage: true });
      console.log('📸 Success screenshot saved: peoplefinder-success.png');
      
    } catch (error) {
      console.log('❌ Confirmation message not found:', getErrMsg(error));
      
      // Take debug screenshot
      await page.screenshot({ path: 'peoplefinder-debug.png', fullPage: true });
      console.log('📸 Debug screenshot saved: peoplefinder-debug.png');
    }
    
    console.log('⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);
    
    console.log('✅ PeopleFinder opt-out process completed!');
    
  } catch (error) {
    console.error('💥 Error during PeopleFinder opt-out:', getErrMsg(error));
    console.error((error as any).stack);
  } finally {
    if (browser) {
      console.log('🧹 Closing browser...');
      await browser.close();
    }
  }
}

// Run the script
if (require.main === module) {
  console.log('PeopleFinder Opt-Out Automation Script');
  console.log('======================================');
  
  peopleFinderOptOut()
    .then(() => {
      console.log('Script completed (success path reached)');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { peopleFinderOptOut };
