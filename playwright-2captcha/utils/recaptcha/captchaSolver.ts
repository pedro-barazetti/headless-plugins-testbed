import { Page, Frame } from 'playwright';
import { getCaptchaParams, CaptchaParams } from './utils/getCaptchaParams';
import { clickAtCoordinates } from './utils/clickAtCoordinates';
import { clickRecaptchaVerifyButton } from './utils/clickRecaptchaVerifyButton';
import { isRecaptchaPassed } from './utils/isRecaptchaPassed';
import { initCaptchaParamsExtractor } from './utils/initCaptchaParamsExtractor';
// @ts-ignore - no types published for this package
import TwoCaptcha = require('@2captcha/captcha-solver');

const apiKey = process.env.TWO_CAPTCHA_KEY;
if (!apiKey) {
    throw new Error('Missing TWO_CAPTCHA_KEY in environment. Create a .env file with TWO_CAPTCHA_KEY=your_key');
}
const solver = new TwoCaptcha.Solver(apiKey, 500);
const sleep = (time: number) => new Promise(resolve => setTimeout(resolve, time));

export const captchaSolverEnterprise = async (page: Page, client: any) => {
    const result = await solver.recaptcha({
          googlekey: client.sitekey,
          pageurl:  client.pageurl,
          invisible: 0,
          enterprise:1
    })
    console.log('Captcha solved:', result);
    return result;
}

export const captchaSolver = async (page: Page): Promise<boolean> => {
  const highlightClicks = false;
  const frameHandle = await page.waitForSelector('iframe[src*="https://www.google.com/recaptcha/api2/bframe"]');
  const frame: Frame | null = await frameHandle?.contentFrame();
  if(!frame) throw new Error('Captcha challenge frame not found');

  await initCaptchaParamsExtractor(frame);

  let isCaptchaNotSolved = true;
  while(isCaptchaNotSolved){
    const captchaParams: CaptchaParams = await getCaptchaParams(frame);
    console.log(`Successfully fetched captcha parameters. recaptcha size is ${captchaParams.columns}*${captchaParams.rows}`);

    //@ts-ignore
    const answer: { status: number; data: string; id: string } = await solver.grid({
      body: captchaParams.body,
      textinstructions: captchaParams.comment,
      cols: captchaParams.columns,
      rows: captchaParams.rows,
      canSkip: 1,
      //@ts-ignore
      img_type: 'recaptcha'
    });

    const isCaptchaAnswered = answer.status === 1;
    if(isCaptchaAnswered){
      console.log(`The answer for captcha ${answer.id} was received successfully`);
      console.log(answer);
      if(answer.data === 'No_matching_images'){
        await sleep(1213);
        await clickRecaptchaVerifyButton(page);
      }
    } else {
      return false;
    }

    let clicks = answer.data.replace('click:', '').split('/').map(Number);
    console.log('Clicks:', clicks);

    const captchaSize = captchaParams.columns;
    const timeToSleep = 100;
    for(let i=0; i<clicks.length; i++){
      await sleep(timeToSleep * i);
      await clickAtCoordinates(page, captchaSize, clicks[i], highlightClicks);
    }

    await sleep(timeToSleep * (clicks.length + 1) + 2202);
    await clickRecaptchaVerifyButton(page, highlightClicks);

    await sleep(3000);
    const isCaptchaSolved = await isRecaptchaPassed(page);
    isCaptchaNotSolved = !isCaptchaSolved;
  }

  return true;
};
