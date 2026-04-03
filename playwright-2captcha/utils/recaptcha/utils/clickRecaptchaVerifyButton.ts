import { Page } from 'playwright';
import { getRandomNumber } from './getRandomNumber';
import { showClickInfo } from './showClickInfo';

export const clickRecaptchaVerifyButton = async (page: Page, highlightClicks = false) => {
  const w = 340; // offset from left
  const h = 540; // offset from top
  const element = await page.$('iframe[src*="https://www.google.com/recaptcha/api2/bframe"]');
  if(!element) throw new Error('Challenge iframe not found for verify button');
  const boundingBox = await element.boundingBox();
  if(!boundingBox) throw new Error('Bounding box not found for verify button');

  let x = boundingBox.x + w + getRandomNumber(1,35);
  let y = boundingBox.y + h + getRandomNumber(1,5);
  console.log(`Click on coordinates x:${x},y:${y}`);
  console.log('Click Verify/Skip');
  await page.mouse.click(x, y);

  if(highlightClicks){
    const clickCoordinatesToShow = { x, y };
    await page.evaluate(({ click, showClickInfoFunc }) => {
      // eslint-disable-next-line no-eval
      eval(showClickInfoFunc);
      // @ts-ignore
      showClickInfo(click.x, click.y);
    }, { click: clickCoordinatesToShow, showClickInfoFunc: showClickInfo.toString() });
  }
};
