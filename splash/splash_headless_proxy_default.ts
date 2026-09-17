import "dotenv/config";
import {
  printSplashComparisonResult,
  runSplashComparisonTarget,
} from "./dual-headless-proxy/runner";

async function main(): Promise<void> {
  const result = await runSplashComparisonTarget({
    name: "Default Crawlera",
    outputDirectory: "output/splash-default-headless-proxy",
    proxyHost: "proxy.crawlera.com:8011",
    proxyProfile: "default",
    splashUrl: process.env.SPLASH_DEFAULT_URL ?? "http://localhost:8052",
  });
  printSplashComparisonResult(result);
  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Default Crawlera Splash test failed:", error);
  process.exit(1);
});
