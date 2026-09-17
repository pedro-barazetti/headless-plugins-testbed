import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  printSplashComparisonResult,
  runSplashComparisonTarget,
} from "./dual-headless-proxy/runner";

async function main(): Promise<void> {
  const [defaultResult, twindolphinResult] = await Promise.all([
    runSplashComparisonTarget({
      name: "Default Crawlera",
      outputDirectory: "output/splash-default-headless-proxy",
      proxyHost: "proxy.crawlera.com:8011",
      proxyProfile: "default",
      splashUrl: process.env.SPLASH_DEFAULT_URL ?? "http://localhost:8052",
    }),
    runSplashComparisonTarget({
      name: "Twindolphin",
      outputDirectory: "output/splash-twindolphin-headless-proxy",
      proxyHost: "twindolphin.crawlera.com:8011",
      proxyProfile: "twindolphin",
      splashUrl: process.env.SPLASH_TWINDOLPHIN_URL ?? "http://localhost:8053",
    }),
  ]);

  console.log("\n=== Comparison ===");
  printSplashComparisonResult(defaultResult);
  console.log("");
  printSplashComparisonResult(twindolphinResult);

  const comparisonDirectory = resolve(process.cwd(), "output/splash-proxy-comparison");
  const elapsedDifferenceMilliseconds = Math.abs(
    defaultResult.elapsedMilliseconds - twindolphinResult.elapsedMilliseconds,
  );
  const fasterRoute =
    defaultResult.elapsedMilliseconds === twindolphinResult.elapsedMilliseconds
      ? "tie"
      : defaultResult.elapsedMilliseconds < twindolphinResult.elapsedMilliseconds
        ? defaultResult.name
        : twindolphinResult.name;
  const summary = {
    bothBlocked:
      (defaultResult.targetHttpStatus ?? 0) >= 400 &&
      (twindolphinResult.targetHttpStatus ?? 0) >= 400,
    bothSucceeded: defaultResult.success && twindolphinResult.success,
    elapsedDifferenceMilliseconds,
    fasterRoute,
    sameTargetHttpStatus:
      defaultResult.targetHttpStatus === twindolphinResult.targetHttpStatus,
  };
  await mkdir(comparisonDirectory, { recursive: true });
  await writeFile(
    resolve(comparisonDirectory, "comparison.json"),
    `${JSON.stringify({ default: defaultResult, twindolphin: twindolphinResult, summary }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Comparison: ${summary.bothBlocked ? "both routes were blocked" : "routes differed"}; ` +
      `${summary.fasterRoute} was faster by ${(elapsedDifferenceMilliseconds / 1_000).toFixed(2)}s`,
  );
  console.log(`\nComparison JSON: ${resolve(comparisonDirectory, "comparison.json")}`);
}

main().catch((error: unknown) => {
  console.error("Splash proxy comparison failed:", error);
  process.exit(1);
});
