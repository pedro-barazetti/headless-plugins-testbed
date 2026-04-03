import 'dotenv/config';
import { chromium } from 'playwright-extra';
import { Browser } from 'playwright';
import { injectTurnstileScript, loadPageAndSolveTurnstile } from './utils/cloudflare-turnstile/turnstile';
import { normalizeUserAgent } from './utils/normalizeUserAgent';
import SmartProxyPlugin from 'zyte-smartproxy-plugin';
import stealth from 'puppeteer-extra-plugin-stealth';

async function usPhoneBookOptOut() {
  let browser: Browser | null = null;
  
  try {
    console.log('🚀 Starting USPhoneBook Opt-Out process...');
    
    const apiKey = process.env.SPM_API_KEY;
    if (!apiKey) {
      throw new Error('Missing API_KEY in environment. Create a .env file with API_KEY=your_key');
    }

    chromium.use(SmartProxyPlugin({
      spm_apikey: apiKey,
      spm_host: 'http://proxy.zyte.com:8011',
      static_bypass: false, //  enable to save bandwidth (but may break some websites)
      block_ads: false, //  enable to save bandwidth (but may break some websites)
    }));

    chromium.use(stealth());

    browser = await chromium.launch({ 
      headless: false,
      devtools: false,
      slowMo: 1000,
      // args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
    });
    
    const normalizedUA = await normalizeUserAgent();
    const context = await browser.newContext({ userAgent: normalizedUA });
    const page = await context.newPage();
    
    // Hardcoded PII data
    const userData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe.test@example.com'
    };

    // 1. Solve Captcha (Cloudflare Turnstile)      
    console.log('📍 Injecting CF Turnstile capture script...');
    await injectTurnstileScript(page);
    
    console.log('📍 Navigating to USPhoneBook opt-out page...');
    await loadPageAndSolveTurnstile(page, 'https://www.usphonebook.com/opt-out');

    
    console.log('⏳ Waiting for reCAPTCHA iframe...');
    try {
      await page.waitForSelector("//iframe[@title='reCAPTCHA']", { timeout: 60000 });
      console.log('✅ reCAPTCHA iframe found');
    } catch (error) {
      console.log('❌ reCAPTCHA iframe not found:', error.message);
    }
    
    // Check for cookie consent and accept if visible
    console.log('🍪 Checking for cookie consent...');
    try {
      const cookieConsentVisible = await page.isVisible("//div[@id='cookieConsent']//button[@class='btn btn-primary accept-btn btnBigText']");
      if (cookieConsentVisible) {
        await page.click("//div[@id='cookieConsent']//button[@class='btn btn-primary accept-btn btnBigText']");
        console.log('✅ Cookie consent accepted');
      } else {
        console.log('ℹ️ No cookie consent dialog visible');
      }
    } catch (error) {
      console.log('⚠️ Cookie consent handling failed:', error.message);
    }
    
    console.log('📝 Starting form filling process...');
    
    // Fill first name
    console.log('1️⃣ Filling first name...');
    try {
      await page.fill('//*[@id="subject-firstname"]', userData.firstName);
      console.log(`✅ First name filled: ${userData.firstName}`);
    } catch (error) {
      console.log('❌ Failed to fill first name:', error.message);
    }
    
    // Fill last name
    console.log('2️⃣ Filling last name...');
    try {
      await page.fill('//*[@id="subject-lastname"]', userData.lastName);
      console.log(`✅ Last name filled: ${userData.lastName}`);
    } catch (error) {
      console.log('❌ Failed to fill last name:', error.message);
    }
    
    // Fill email
    console.log('3️⃣ Filling email...');
    try {
      await page.fill('//*[@id="subject-email"]', userData.email);
      console.log(`✅ Email filled: ${userData.email}`);
    } catch (error) {
      console.log('❌ Failed to fill email:', error.message);
    }
    
    // Check agreement checkbox
    console.log('4️⃣ Checking agreement checkbox...');
    try {
      await page.check('//*[@id="agreement"]');
      console.log('✅ Agreement checkbox checked');
    } catch (error) {
      console.log('❌ Failed to check agreement:', error.message);
    }
    
    console.log('5️⃣ CAPTCHA handling...');
    // Solve CAPTCHA
    
    // Click submit button
    console.log('6️⃣ Clicking submit button...');
    try {
      await page.click("//button[@id='BRP']");
      console.log('✅ Submit button clicked');
    } catch (error) {
      console.log('❌ Failed to click submit button:', error.message);
    }
    
    // Check if confirmation message is visible within 5 seconds
    console.log('7️⃣ Checking for immediate confirmation...');
    try {
      const immediateConfirmation = await page.isVisible('//*[text()[contains(., "email has been sent")]]', { timeout: 5000 });
      if (!immediateConfirmation) {
        console.log('⚠️ Immediate confirmation not found, solving CAPTCHA again...');
        // Solve CAPTCHA
      } else {
        console.log('✅ Immediate confirmation found');
      }
    } catch (error) {
      console.log('⚠️ Immediate confirmation check failed:', error.message);
    }
    
    // Final check for confirmation message
    console.log('8️⃣ Waiting for final confirmation message...');
    try {
      const confirmationVisible = await page.isVisible('//*[text()[contains(., "email has been sent")]]', { timeout: 30000 });
      if (confirmationVisible) {
        console.log('✅ SUCCESS! Confirmation message found: "email has been sent"');
        
        // Take success screenshot
        await page.screenshot({ path: 'usphonebook-success.png', fullPage: true });
        console.log('📸 Success screenshot saved: usphonebook-success.png');
        
      } else {
        console.log('❌ FAILED! Confirmation text not found');
        
        // Take debug screenshot
        await page.screenshot({ path: 'usphonebook-debug.png', fullPage: true });
        console.log('📸 Debug screenshot saved: usphonebook-debug.png');
      }
    } catch (error) {
      console.log('❌ Final confirmation check failed:', error.message);
      
      // Take error screenshot
      await page.screenshot({ path: 'usphonebook-error.png', fullPage: true });
      console.log('📸 Error screenshot saved: usphonebook-error.png');
    }
    
    console.log('⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);
    
    console.log('✅ USPhoneBook opt-out process completed!');
    
  } catch (error) {
    console.error('💥 Error during USPhoneBook opt-out:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      console.log('🧹 Closing browser...');
      await browser.close();
    }
  }
}

// Run the script
if (require.main === module) {
  console.log('USPhoneBook Opt-Out Automation Script');
  console.log('====================================');
  
  usPhoneBookOptOut()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { usPhoneBookOptOut };
