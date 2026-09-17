import {
  ZyteCdpSession,
  closeZyteCdp,
  connectToZyteCdp,
  navigateWithCdp,
  saveScreenshot,
} from './zyteCdp';

const TARGET_URL = 'https://thatsthem.com/name/John-Smith/Tempe-AZ';

export async function thatsThemCdpTest(): Promise<void> {
  let session: ZyteCdpSession | null = null;

  try {
    session = await connectToZyteCdp();
    const { page } = session;

    console.log(`Navigating to ${TARGET_URL}`);
    const response = await navigateWithCdp(page, TARGET_URL);

    // Allow Zyte Browser to finish automatic CAPTCHA handling and let the
    // resulting page settle before taking the screenshot.
    await page.waitForTimeout(10_000);

    console.log(`HTTP status: ${response?.status() ?? 'unknown'}`);
    console.log(`Final URL: ${page.url()}`);
    console.log(`Page title: ${await page.title()}`);
    const resultsVisible = await page
      .getByText(/Results for John Smith in Tempe, AZ/i)
      .first()
      .isVisible({ timeout: 30_000 })
      .catch(() => false);
    const screenshotPath = await saveScreenshot(page, 'thatsthem.png');

    if (!resultsVisible) {
      throw new Error(
        `The expected results page was not visible after automatic challenge handling. Screenshot saved to ${screenshotPath}`,
      );
    }

    console.log('That’s Them results rendered successfully after automatic challenge handling.');
  } finally {
    await closeZyteCdp(session);
  }
}

if (require.main === module) {
  thatsThemCdpTest().catch((error) => {
    console.error('That’s Them CDP test failed:', error);
    process.exitCode = 1;
  });
}
