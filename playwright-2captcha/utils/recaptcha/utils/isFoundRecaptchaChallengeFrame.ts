import { Page } from 'playwright';

export async function isFoundRecaptchaChallengeFrame(page: Page): Promise<boolean>{
  try {
    const frameHandle = await page.waitForSelector('iframe[src*="https://www.google.com/recaptcha/api2/bframe"]', { timeout: 15000 });
    if(!frameHandle) return false;
    const frame = await frameHandle.contentFrame();
    if(!frame) return false;
    const isFoundDosMessage = await frame.evaluate(() => {
      const dosMessageElement = document.querySelector('.rc-doscaptcha-header');
      return !!dosMessageElement;
    });
    if (isFoundDosMessage) {
      console.log("Error message: 'Try again later. Your computer or network may be sending automated queries...'");
      console.log("To get the captcha, you need to change your IP address");
      return false;
    }
    return true;
  } catch (e){
    console.error('An error occurred while searching for the reCAPTCHA frame:', e);
    return false;
  }
}
