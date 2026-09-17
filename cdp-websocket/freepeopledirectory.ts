import {
  ZyteCdpSession,
  closeZyteCdp,
  connectToZyteCdp,
  detectCaptchaOrChallenge,
  envFlag,
  navigateWithCdp,
  saveScreenshot,
} from './zyteCdp';

const OPTOUT_URL = 'https://www.freepeopledirectory.com/optout';
const DEFAULT_PROFILE_URL =
  'https://www.freepeopledirectory.com/person/Richard-Smith/Dallas-TX/p10281241131';

export async function freePeopleDirectoryCdpTest(): Promise<void> {
  let session: ZyteCdpSession | null = null;

  try {
    session = await connectToZyteCdp();
    const { page } = session;
    const profileUrl = process.env.FREEPEOPLEDIRECTORY_PROFILE_URL || DEFAULT_PROFILE_URL;

    console.log(`Navigating to ${OPTOUT_URL}`);
    const response = await navigateWithCdp(page, OPTOUT_URL);
    console.log(`HTTP status: ${response?.status() ?? 'unknown'}`);
    console.log(`Page title: ${await page.title()}`);

    const urlInput = page.locator('form input[name="url"]').first();
    const formAvailable = await urlInput.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!formAvailable) {
      const challenge = await detectCaptchaOrChallenge(page);
      await saveScreenshot(page, 'freepeopledirectory-blocked.png');
      throw new Error(
        challenge.detected
          ? `Opt-out form is blocked by: ${challenge.indicators.join(', ')}`
          : 'Opt-out form was not found',
      );
    }

    await urlInput.fill(profileUrl);
    if ((await urlInput.inputValue()) !== profileUrl) {
      throw new Error('Profile URL was not entered correctly');
    }

    await saveScreenshot(page, 'freepeopledirectory-ready.png');

    if (!envFlag('FREEPEOPLEDIRECTORY_SUBMIT')) {
      console.log(
        'CDP connection and opt-out form passed. Submission was skipped; set FREEPEOPLEDIRECTORY_SUBMIT=true to submit.',
      );
      return;
    }

    const submitButton = page
      .locator(
        'form input.opt-submit-button, form input[type="submit"], form button[type="submit"], form button',
      )
      .first();
    if (!(await submitButton.isVisible({ timeout: 10_000 }).catch(() => false))) {
      throw new Error('Opt-out submit button was not found');
    }

    console.log('Submitting the FreePeopleDirectory opt-out request...');
    await submitButton.click();

    const successMessage = page.getByText(/the listing has been removed/i).first();
    const submitted = await successMessage.isVisible({ timeout: 30_000 }).catch(() => false);
    if (!submitted) {
      const challenge = await detectCaptchaOrChallenge(page);
      await saveScreenshot(page, 'freepeopledirectory-no-confirmation.png');
      throw new Error(
        challenge.detected
          ? `Submission encountered: ${challenge.indicators.join(', ')}`
          : 'Submission did not show the expected removal confirmation',
      );
    }

    console.log(`Confirmation: ${(await successMessage.textContent())?.trim()}`);
    await saveScreenshot(page, 'freepeopledirectory-success.png');
  } finally {
    await closeZyteCdp(session);
  }
}

if (require.main === module) {
  freePeopleDirectoryCdpTest().catch((error) => {
    console.error('FreePeopleDirectory CDP test failed:', error);
    process.exitCode = 1;
  });
}
