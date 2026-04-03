import 'dotenv/config';
//@ts-ignore
import { chromium, Browser, Page } from 'zyte-smartproxy-playwright';
import { solveTurnstile, injectTurnstileToken } from './utils/cloudflare-turnstile/turnstile';
import { normalizeUserAgent } from './utils/normalizeUserAgent';

function getErrMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function clustrmapsOptOut() {
  let browser: Browser | null = null;
  
  try {
    console.log('🚀 Starting Clustrmaps Opt-Out process...');
    
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error('Missing API_KEY in environment. Create a .env file with API_KEY=your_key');
    }

    const normalizedUA = await normalizeUserAgent();
    browser = await chromium.launch({ 
      spm_apikey: apiKey,
      spm_host: 'http://api.zyte.com:8011',
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
      email: 'john.doe.test@example.com',
      city: 'Los Angeles',
      state: 'CA',
      phone: '5551234567'
    };
    
    console.log('📍 Navigating to Clustrmaps opt-out page...');
    await page.goto('https://clustrmaps.com/bl/opt-out', { 
      waitUntil: 'domcontentloaded',
      timeout: 90000 
    });
    
    console.log('⏳ Waiting for form to load...');
    await page.waitForTimeout(3000);
    
    console.log('📝 Starting opt-out process...');
    
    // 1. Fill email in the initial form
    console.log('1️⃣ Filling email address...');
    try {
      await page.waitForSelector('//form[@id="remove"]//input[@name="inputEmail"]', { timeout: 10000 });
      await page.fill('//form[@id="remove"]//input[@name="inputEmail"]', userData.email);
      console.log('✅ Email filled');
    } catch (error: unknown) {
      console.log('❌ Failed to fill email:', getErrMsg(error));
    }
    
    // 2. Solve CAPTCHA (Cloudflare Turnstile via 2Captcha)
    try {
      console.log('2️⃣ Solving Turnstile captcha...');
      const twoCaptchaKey = process.env.TWO_CAPTCHA_KEY;
      if (!twoCaptchaKey) {
        throw new Error('Missing TWO_CAPTCHA_KEY in environment. Add it to your .env file');
      }

      // Ensure the widget is present
      await page.waitForSelector('.cf-turnstile, [data-sitekey]', { timeout: 30000 });
      const { token } = await solveTurnstile(page, { apiKey: twoCaptchaKey });
      await injectTurnstileToken(page, token, 'input[name="cf-turnstile-response"]', 'form#remove');
      console.log('✅ Turnstile token injected.');
    } catch (error: unknown) {
      console.log('⚠️ Turnstile solving failed or not required:', getErrMsg(error));
    }  
    
    // 3. Submit initial form
    console.log('3️⃣ Submitting initial form...');
    try {
      await page.click('//*[@id="remove"]//button[@type="submit"]');
      console.log('✅ Initial form submitted');
      await page.waitForTimeout(3000);
    } catch (error: unknown) {
      console.log('❌ Failed to submit initial form:', getErrMsg(error));
    }
    
    // 4. Fill person name
    console.log('4️⃣ Filling person name...');
    try {
      await page.waitForSelector('//*[@id="personName"]', { timeout: 10000 });
      const fullName = `${userData.firstName} ${userData.lastName}`;
      await page.fill('//*[@id="personName"]', fullName);
      console.log(`✅ Person name filled: ${fullName}`);
    } catch (error: unknown) {
      console.log('❌ Failed to fill person name:', getErrMsg(error));
    }
    
    // 5. Fill city and state with autocomplete
    console.log('5️⃣ Filling city and state...');
    try {
      // Hover and click on city/state field
      await page.hover('//*[@id="cityState"]');
      await page.waitForTimeout(3000);
      await page.click('//*[@id="cityState"]');
      await page.waitForTimeout(3000);
      
      // Fill city and state
      const cityState = `${userData.city}, ${userData.state}`;
      await page.fill('//*[@id="cityState"]', cityState);
      console.log(`✅ City/State filled: ${cityState}`);
      
      // Wait for autocomplete suggestions and click first one
      await page.waitForTimeout(2000);
      try {
        await page.waitForSelector('//div[@class="deep-suggestion-block"][1]', { timeout: 5000 });
        await page.click('//div[@class="deep-suggestion-block"][1]');
        console.log('✅ Selected first autocomplete suggestion');
      } catch (suggestionError: unknown) {
        console.log('⚠️ No autocomplete suggestion found, continuing...');
      }
      
    } catch (error: unknown) {
      console.log('❌ Failed to fill city/state:', getErrMsg(error));
    }
    
    // 6. Click Find Person button
    console.log('6️⃣ Clicking Find Person button...');
    try {
      await page.waitForSelector('//button[text()="Find Person"]', { timeout: 40000 });
      await page.click('//button[text()="Find Person"]');
      console.log('✅ Find Person button clicked');
      await page.waitForTimeout(5000);
    } catch (error: unknown) {
      console.log('❌ Failed to click Find Person button:', getErrMsg(error));
    }
    
    // 7. Wait for search results and click first "Proceed to Opt Out"
    console.log('7️⃣ Looking for search results...');
    try {
      const optOutSelector = '//a[text()="Proceed to Opt Out"]';
      await page.waitForSelector(optOutSelector, { timeout: 60000 });
      
      // Get all "Proceed to Opt Out" links
      const optOutLinks = await page.$$(optOutSelector);
      console.log(`Found ${optOutLinks.length} search results`);
      
      if (optOutLinks.length === 0) {
        throw new Error('No search results found');
      }
      
      // Click the first one
      console.log('🎯 Clicking first "Proceed to Opt Out" link...');
      await optOutLinks[0].click();
      console.log('✅ Clicked first opt-out link');
      await page.waitForTimeout(3000);
      
    } catch (error: unknown) {
      console.log('❌ Failed to find or click opt-out link:', getErrMsg(error));
      
      // Take screenshot for debugging
      await page.screenshot({ path: 'clustrmaps-debug-search.png', fullPage: true });
      console.log('📸 Debug screenshot saved: clustrmaps-debug-search.png');
      throw error;
    }
    
    // 8. Wait for removal page and select checkboxes
    console.log('8️⃣ Selecting records to remove...');
    try {
      await page.waitForSelector('//h4[contains(text(),"Remove persons")]', { timeout: 30000 });
      console.log('✅ Reached removal page');
      
      // Find checkboxes for the person (simplified - just select based on name)
      const fNameLower = userData.firstName.toLowerCase();
      const lNameLower = userData.lastName.toLowerCase();
      
      const checkboxXpath = `//div[@class="pr_addr"]/input[@type="checkbox"][following-sibling::span[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${fNameLower}") and contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${lNameLower}")]]`;
      
      const matching = page.locator(checkboxXpath);
      const count = await matching.count();
      console.log(`Found ${count} matching checkboxes`);

      if (count > 0) {
        await matching.first().check();
        console.log('✅ Selected first matching record');
        await page.waitForTimeout(5000);
      } else {
        const anyCheckbox = page.locator('//div[@class="pr_addr"]/input[@type="checkbox"]').first();
        if (await anyCheckbox.count()) {
          await anyCheckbox.check();
          console.log('✅ Selected first available record (fallback)');
          await page.waitForTimeout(5000);
        } else {
          throw new Error('No checkboxes found to select');
        }
      }
      
    } catch (error: unknown) {
      console.log('❌ Failed to select records:', getErrMsg(error));
    }
    
    // 9. Handle phone number selection (simplified - just one phone)
    console.log('9️⃣ Selecting phone number...');
    try {
      const phoneStr = userData.phone.replace(/\D/g, ''); // Remove non-digits
      const phoneCheckbox = await page.$(`//input[@id="${phoneStr}"]`);
      
      if (phoneCheckbox) {
        await phoneCheckbox.click();
        console.log(`✅ Selected phone number: ${phoneStr}`);
      } else {
        console.log('⚠️ Specific phone checkbox not found, trying generic phone checkboxes...');
        
        // Try to find any phone checkboxes
        const phoneCheckboxes = await page.$$('//input[contains(@id, "555") or contains(@id, "phone")]');
        if (phoneCheckboxes.length > 0) {
          await phoneCheckboxes[0].click();
          console.log('✅ Selected first available phone number');
        } else {
          console.log('ℹ️ No phone checkboxes found');
        }
      }
    } catch (error: unknown) {
      console.log('⚠️ Phone selection failed:', getErrMsg(error));
    }
    
    // 10. Submit the removal form
    console.log('🔟 Submitting removal form...');
    try {
      const submitSelector = '//form[contains(@class,"deletor")]/input[@type="submit"]';
      await page.waitForSelector(submitSelector, { timeout: 10000 });
      await page.click(submitSelector);
      console.log('✅ Removal form submitted');
    } catch (error: unknown) {
      console.log('❌ Failed to submit removal form:', getErrMsg(error));
    }
    
    // 11. Check for success message
    console.log('1️⃣1️⃣ Waiting for success confirmation...');
    try {
      await page.waitForSelector('//*[text()[contains(., "Success")]]', { timeout: 40000 });
      console.log('✅ SUCCESS! Opt-out completed successfully');
      
      // Take success screenshot
      await page.screenshot({ path: 'clustrmaps-success.png', fullPage: true });
      console.log('📸 Success screenshot saved: clustrmaps-success.png');
      
    } catch (error: unknown) {
      console.log('❌ Success message not found:', getErrMsg(error));
      
      // Take debug screenshot
      await page.screenshot({ path: 'clustrmaps-debug-final.png', fullPage: true });
      console.log('📸 Debug screenshot saved: clustrmaps-debug-final.png');
      
      // Check if we're on a different page (might indicate success)
      const currentUrl = page.url();
      console.log(`📍 Current URL: ${currentUrl}`);
      
      if (currentUrl.includes('success') || currentUrl.includes('complete')) {
        console.log('✅ URL indicates success even without explicit message');
      }
    }
    
    console.log('⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);
    
    console.log('✅ Clustrmaps opt-out process completed!');
    
  } catch (error: unknown) {
    console.error('💥 Error during Clustrmaps opt-out:', getErrMsg(error));
    if (error instanceof Error) {
      console.error(error.stack);
    }
    
    // Take error screenshot
    if (browser) {
      try {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          const pages = contexts[0].pages();
          if (pages.length > 0) {
            await pages[0].screenshot({ path: 'clustrmaps-error.png', fullPage: true });
            console.log('📸 Error screenshot saved: clustrmaps-error.png');
          }
        }
      } catch (screenshotError: unknown) {
        console.log('❌ Failed to take error screenshot');
      }
    }
  } finally {
    if (browser) {
      console.log('🧹 Closing browser...');
      await browser.close();
    }
  }
}

// Run the script
if (require.main === module) {
  console.log('Clustrmaps Opt-Out Automation Script');
  console.log('====================================');
  
  clustrmapsOptOut()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { clustrmapsOptOut };
