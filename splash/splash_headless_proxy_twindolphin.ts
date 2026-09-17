import "dotenv/config";
import {
  printSplashComparisonResult,
  runSplashComparisonTarget,
} from "./dual-headless-proxy/runner";

async function main(): Promise<void> {
  const result = await runSplashComparisonTarget({
    name: "Twindolphin",
    outputDirectory: "output/splash-twindolphin-headless-proxy",
    proxyHost: "twindolphin.crawlera.com:8011",
    proxyProfile: "twindolphin",
    splashUrl: process.env.SPLASH_TWINDOLPHIN_URL ?? "http://localhost:8053",
  });
  printSplashComparisonResult(result);
  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Twindolphin Splash test failed:", error);
  process.exit(1);
});
