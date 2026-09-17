import {
  ZyteCdpSession,
  closeZyteCdp,
  connectToZyteCdp,
  navigateWithCdp,
  saveScreenshot,
} from './zyteCdp';

async function main(): Promise<void> {
  let session: ZyteCdpSession | null = null;

  try {
    session = await connectToZyteCdp();
    const targetUrl = process.env.CDP_SMOKE_URL || 'https://example.com/';
    const response = await navigateWithCdp(session.page, targetUrl, 60_000);

    if (!response) throw new Error(`Navigation returned no response for ${targetUrl}`);

    console.log(`HTTP status: ${response.status()}`);
    console.log(`Page title: ${await session.page.title()}`);
    await saveScreenshot(session.page, 'smoke.png');
  } finally {
    await closeZyteCdp(session);
  }
}

main().catch((error) => {
  console.error('CDP smoke test failed:', error);
  process.exitCode = 1;
});
