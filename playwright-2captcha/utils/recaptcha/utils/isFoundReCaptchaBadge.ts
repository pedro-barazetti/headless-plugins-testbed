import { Page } from 'playwright';

export async function isFoundReCaptchaBadge(page: Page): Promise<boolean>{
  const recaptchaBadge = await page.evaluate(() => {
    const badge = document.querySelector('iframe[src*="https://www.google.com/recaptcha/api2"]');
    return !!badge;
  });
  return recaptchaBadge;
}
