import { Page } from 'playwright';

export async function isRecaptchaPassed(page: Page): Promise<boolean>{
  const frames = page.frames();
  for(const frame of frames){
    const el = await frame.$('.recaptcha-checkbox-checked');
    if(el) return true;
  }
  return false;
}
