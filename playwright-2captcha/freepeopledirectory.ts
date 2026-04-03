import 'dotenv/config';
//@ts-ignore
import { chromium, Browser, Page } from 'zyte-smartproxy-playwright';
import { normalizeUserAgent } from './utils/normalizeUserAgent';

async function freePeopleDirectoryOptOut() {
  let browser: Browser | null = null;
  
  try {
    console.log('🚀 Starting FreePeopleDirectory Opt-Out process...');
    
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
    });
  
    const context = await browser.newContext({ userAgent: normalizedUA });
    const page = await context.newPage();
    
    // Hardcoded profile URL to opt out
    const profileUrl = 'https://www.freepeopledirectory.com/person/Richard-Smith/Dallas-TX/p10281241131';
    
    console.log(`📋 Profile URL to opt out: ${profileUrl}`);
    
    console.log('📍 Navigating to FreePeopleDirectory opt-out page...');
    await page.goto('https://www.freepeopledirectory.com/optout', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('⏳ Waiting for opt-out form to load...');
    await page.waitForTimeout(3000);
    
    // Check if we're on the right page
    const pageTitle = await page.title();
    console.log(`📄 Page title: ${pageTitle}`);
    
    console.log('📝 Starting opt-out process...');
    
    // 1. Validate that the opt-out form exists
    console.log('1️⃣ Looking for opt-out form...');
    try {
      await page.waitForSelector('//form//input[@name="url"]', { timeout: 10000 });
      console.log('✅ Opt-out form found');
    } catch (error) {
      // With useUnknownInCatchVariables=false, error is any here
      console.log('❌ Opt-out form not found:', (error as any).message);
      
      // Take screenshot for debugging
      await page.screenshot({ path: 'freepeopledirectory-no-form.png', fullPage: true });
      console.log('📸 Debug screenshot saved: freepeopledirectory-no-form.png');
      throw error;
    }
    
    // 2. Fill the profile URL
    console.log('2️⃣ Filling profile URL...');
    try {
      await page.fill('//form//input[@name="url"]', profileUrl);
      console.log('✅ Profile URL filled');
      
      // Verify the URL was filled correctly
      const filledValue = await page.inputValue('//form//input[@name="url"]');
      console.log(`🔍 Verified filled value: ${filledValue}`);
      
      if (filledValue !== profileUrl) {
        console.log('⚠️ Warning: Filled value does not match expected URL');
      }
      
    } catch (error) {
      console.log('❌ Failed to fill profile URL:', (error as any).message);
      throw error;
    }
    
    // 3. Submit the opt-out form
    console.log('4️⃣ Submitting opt-out form...');
    try {
      // Look for the submit button with multiple possible selectors
      const submitSelectors = [
        '//form//input[contains(@class, "opt-submit-button")]'
      ];
      
      let submitClicked = false;
      for (const selector of submitSelectors) {
        try {
          const submitButton = await page.$(selector);
          if (submitButton) {
            const isVisible = await submitButton.isVisible();
            const isEnabled = await submitButton.isEnabled();
            
            console.log(`Found submit button: ${selector} (visible: ${isVisible}, enabled: ${isEnabled})`);
            
            if (isVisible && isEnabled) {
              await page.click(selector);
              console.log(`✅ Clicked submit button: ${selector}`);
              submitClicked = true;
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (!submitClicked) {
        console.log('❌ No submit button found or clickable');
        
        // Log all form elements for debugging
        const formElements = await page.$$eval('form input, form button', (elements: any) => 
          elements.map((el:any) => ({
            tagName: el.tagName,
            type: el.getAttribute('type'),
            className: el.getAttribute('class'),
            value: el.getAttribute('value'),
            text: el.textContent?.trim(),
            name: el.getAttribute('name'),
            id: el.getAttribute('id')
          }))
        );
        console.log('📋 All form elements found:', formElements);
        throw new Error('Submit button not found');
      }
      
    } catch (error) {
      console.log('❌ Failed to submit form:', (error as any).message);
      
      // Take screenshot for debugging
      await page.screenshot({ path: 'freepeopledirectory-submit-error.png', fullPage: true });
      console.log('📸 Submit error screenshot saved: freepeopledirectory-submit-error.png');
      throw error;
    }
    
    // 5. Wait for response and check for success message
    console.log('5️⃣ Waiting for opt-out confirmation...');
    try {
      // Wait for page to process the request
      await page.waitForTimeout(5000);
      
      // Look for success message
      const successSelectors = [
        '//*[text()[contains(., "The listing has been removed")]]'
      ];
      
      let successFound = false;
      let successMessage = '';
      
      for (const selector of successSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          const element = await page.$(selector);
          if (element) {
            successMessage = await element.textContent() || '';
            console.log(`✅ SUCCESS! Found success message: "${successMessage.trim()}"`);
            successFound = true;
            break;
          }
        } catch (e) {
          // Continue searching
        }
      }
      
      if (successFound) {
        // Take success screenshot
        await page.screenshot({ path: 'freepeopledirectory-success.png', fullPage: true });
        console.log('📸 Success screenshot saved: freepeopledirectory-success.png');
        
        console.log('🎉 Profile successfully opted out from FreePeopleDirectory!');
      } else {
        console.log('❌ Success message not found');
        
        // Check current URL and page content for debugging
        const currentUrl = page.url();
        const pageContent = await page.textContent('body');
        
        console.log(`📍 Current URL: ${currentUrl}`);
        console.log('📋 Page content (first 500 chars):', pageContent?.substring(0, 500));
        
        // Take debug screenshot
        await page.screenshot({ path: 'freepeopledirectory-no-success.png', fullPage: true });
        console.log('📸 Debug screenshot saved: freepeopledirectory-no-success.png');
        
        // Check if URL changed (might indicate success)
        if (currentUrl !== 'https://www.freepeopledirectory.com/optout') {
          console.log('✅ URL changed - this might indicate successful processing');
        }
        
      }
      
    } catch (error) {
      console.log('❌ Error checking for success message:', (error as any).message);
      
      // Take error screenshot
      await page.screenshot({ path: 'freepeopledirectory-check-error.png', fullPage: true });
      console.log('📸 Error screenshot saved: freepeopledirectory-check-error.png');
    }
    
    console.log('⏳ Keeping browser open for 10 seconds for manual inspection...');
    await page.waitForTimeout(10000);
    
    console.log('✅ FreePeopleDirectory opt-out process completed!');
    
  } catch (error) {
    console.error('💥 Error during FreePeopleDirectory opt-out:', (error as any).message);
    console.error((error as any).stack);
    
    // Take error screenshot
    if (browser) {
      try {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          const pages = contexts[0].pages();
          if (pages.length > 0) {
            await pages[0].screenshot({ path: 'freepeopledirectory-error.png', fullPage: true });
            console.log('📸 Error screenshot saved: freepeopledirectory-error.png');
          }
        }
      } catch (screenshotError) {
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
  console.log('FreePeopleDirectory Opt-Out Automation Script');
  console.log('==============================================');
  console.log('Profile URL: https://www.freepeopledirectory.com/person/Richard-Smith/Dallas-TX/p10281241131');
  console.log('');
  
  freePeopleDirectoryOptOut()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { freePeopleDirectoryOptOut };
