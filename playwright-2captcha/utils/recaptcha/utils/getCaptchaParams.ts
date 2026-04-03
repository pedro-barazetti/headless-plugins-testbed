import { Frame } from 'playwright';

export interface CaptchaParams {
  rows: number;
  columns: number;
  comment: string;
  body: string; // base64
  type: string;
}

export async function getCaptchaParams(frame: Frame): Promise<CaptchaParams>{
  const result = await frame.evaluate(() => {
    // @ts-ignore
    return window.getRecaptchaParams();
  });
  return result as CaptchaParams;
}
