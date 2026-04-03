import { Page } from 'playwright';
import { showClickInfo } from './showClickInfo';
import { getRandomNumber } from './getRandomNumber';

export const clickAtCoordinates = async (
  page: Page,
  recaptchaSize: number = 3,
  number: number = 1,
  highlightClicks: boolean = false
) => {
  const element = await page.$('iframe[src*="https://www.google.com/recaptcha/api2/bframe"]');
  if(!element) throw new Error('Challenge iframe not found for clicking');
  const boundingBox = await element.boundingBox();
  if(!boundingBox) throw new Error('Bounding box not available for iframe');

  let { x, y } = boundingBox;

  if(recaptchaSize === 3){
    switch(number){
      case 1: x = x + 60; y = y + 120 + 65; break;
      case 2: x = x + 60 + 130; y = y + 120 + 65; break;
      case 3: x = x + 60 + 130 + 130; y = y + 120 + 65; break;
      case 4: x = x + 60; y = y + 120 + 130 + 65; break;
      case 5: x = x + 60 + 130; y = y + 120 + 130 + 65; break;
      case 6: x = x + 60 + 130 + 130; y = y + 120 + 130 + 65; break;
      case 7: x = x + 60; y = y + 120 + 130 + 130 + 65; break;
      case 8: x = x + 60 + 130; y = y + 120 + 130 + 130 + 65; break;
      case 9: x = x + 60 + 130 + 130; y = y + 120 + 130 + 130 + 65; break;
    }
  }

  if(recaptchaSize === 4){
    let heightTop = 130;
    let width = 95;
    switch(number){
      case 1: x = x + 45; y = y + 45 + heightTop; break;
      case 2: x = x + 45 + width; y = y + 45 + heightTop; break;
      case 3: x = x + 45 + width*2; y = y + 45 + heightTop; break;
      case 4: x = x + 45 + width*3; y = y + 45 + heightTop; break;
      case 5: x = x + 45; y = y + 45 + heightTop + width; break;
      case 6: x = x + 45 + width; y = y + 45 + heightTop + width; break;
      case 7: x = x + 45 + width*2; y = y + 45 + heightTop + width; break;
      case 8: x = x + 45 + width*3; y = y + 45 + heightTop + width; break;
      case 9: x = x + 45; y = y + 45 + heightTop + width*2; break;
      case 10: x = x + 45 + width; y = y + 45 + heightTop + width*2; break;
      case 11: x = x + 45 + width*2; y = y + 45 + heightTop + width*2; break;
      case 12: x = x + 45 + width*3; y = y + 45 + heightTop + width*2; break;
      case 13: x = x + 45; y = y + 45 + heightTop + width*3; break;
      case 14: x = x + 45 + width; y = y + 45 + heightTop + width*3; break;
      case 15: x = x + 45 + width*2; y = y + 45 + heightTop + width*3; break;
      case 16: x = x + 45 + width*3; y = y + 45 + heightTop + width*3; break;
    }
  }

  x = x + getRandomNumber(1,5);
  y = y + getRandomNumber(1,5);
  console.log(`Click on coordinates x:${x},y:${y}`);
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
