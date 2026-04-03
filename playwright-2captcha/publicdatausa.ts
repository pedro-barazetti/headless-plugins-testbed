import 'dotenv/config';
//@ts-ignore
import { chromium, Browser, Page } from 'zyte-smartproxy-playwright';
import { normalizeUserAgent } from './utils/normalizeUserAgent';
import { solveRecaptcha } from './utils/recaptcha';

async function publicDataUSAOptOut() {
  let browser: Browser | null = null;
  
  try {
    console.log('🚀 Starting PublicDataUSA Opt-Out process...');
    
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error('Missing API_KEY in environment. Create a .env file with API_KEY=your_key');
    }

    browser = await chromium.launch({
      spm_apikey: apiKey,
      spm_host: 'http://api.zyte.com:8011',
      headless: false,
      devtools: false,
      slowMo: 100,
      static_bypass: false, 
      block_ads: false
    });
    
    const normalizedUA = await normalizeUserAgent();
    const context = await browser.newContext({ userAgent: normalizedUA });
    const page = await context.newPage({ignoreHTTPSErrors: true});
    
    // Hardcoded PII data
    const userData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe.test@example.com',
      url: 'https://publicdatausa.com/Dong-Lee-TX'
    };
    
    console.log('📍 Navigating to PublicDataUSA remove page...');
    // 1. Solve Captcha (Cloudflare Turnstile)      
/*     console.log('📍 Injecting capture script...');
    await injectTurnstileScript(page);
    
    console.log('📍 Navigating to USPhoneBook opt-out page...');
    await loadPageAndSolveTurnstile(page, 'https://publicdatausa.com/remove.php'); */

    await page.goto('https://publicdatausa.com/remove.php', { 
      waitUntil: 'domcontentloaded',
      timeout: 120000 
    });

    
    console.log('⏳ Waiting for page to load...');
    await page.waitForTimeout(3000);
    
    console.log('📝 Starting opt-out process...');

    // 2. Fill name field
    console.log('2️⃣ Filling name field...');
    try {
      const fullName = `${userData.firstName} ${userData.lastName}`;
      await page.fill('//input[@id="name"]', fullName);
      console.log(`✅ Name filled: ${fullName}`);
    } catch (error) {
      console.log('❌ Failed to fill name:', error.message);
    }
    
    // 3. Fill URL field
    console.log('3️⃣ Filling URL field...');
    try {
      await page.fill('//input[@id="URL"]', userData.url);
      console.log(`✅ URL filled: ${userData.url}`);
    } catch (error) {
      console.log('❌ Failed to fill URL:', error.message);
    }
    
    // 4. Fill email field
    console.log('4️⃣ Filling email field...');
    try {
      await page.fill('//input[@id="email"]', userData.email);
      console.log(`✅ Email filled: ${userData.email}`);
    } catch (error) {
      console.log('❌ Failed to fill email:', error.message);
    }
    
    // 1. Wait for CAPTCHA iframe and solve it
    console.log('1️⃣ Waiting for CAPTCHA iframe...');
    try {
      await page.waitForSelector('//div[@class="g-recaptcha"]//iframe', { timeout: 30000 });
      console.log('✅ CAPTCHA iframe found');
      // Pass `true` to shim a missing global recaptcha() function if the site references it
      await solveRecaptcha(page, '//div[@class="g-recaptcha"]//iframe');
    } catch (error) {
      console.log('❌ CAPTCHA iframe not found:', error.message);
    }
    

    
    // 5. Submit form (commented out in twig script, but we'll include it)
    console.log('5️⃣ Submitting form...');
    try {
      await page.click('//button[@id="send-message"]');
      console.log('✅ Form submitted');
    } catch (error) {
      console.log('❌ Failed to submit form:', error.message);
    }
    
    // 6. Wait for confirmation message
    console.log('6️⃣ Waiting for confirmation message...');
    try {
      await page.waitForSelector('//*[text()[contains(., "received your opt-out request for")]]', { timeout: 130000 });
      console.log('✅ SUCCESS! Confirmation message found: "received your opt-out request for"');
      
      // Take success screenshot
      await page.screenshot({ path: 'publicdatausa-success.png', fullPage: true });
      console.log('📸 Success screenshot saved: publicdatausa-success.png');
      
    } catch (error) {
      console.log('❌ Confirmation message not found:', error.message);
      
      // Take debug screenshot
      await page.screenshot({ path: 'publicdatausa-debug.png', fullPage: true });
      console.log('📸 Debug screenshot saved: publicdatausa-debug.png');
    }
    
    console.log('⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);
    
    console.log('✅ PublicDataUSA opt-out process completed!');
    
  } catch (error) {
    console.error('💥 Error during PublicDataUSA opt-out:', error.message);
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
  console.log('PublicDataUSA Opt-Out Automation Script');
  console.log('=======================================');
  
  publicDataUSAOptOut()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { publicDataUSAOptOut };
