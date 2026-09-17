import { Page, PuppeteerLifeCycleEvent } from "puppeteer-core";

const waitUntil: PuppeteerLifeCycleEvent[] = [
  "domcontentloaded",
  "networkidle2",
];

/**
 * Perform an action that results in navigation such as clicking a link or navigating directly to a
 * page, and wait for the navigation event to complete.
 *
 * @export
 * @param {pptr.Page} tab - the browser tab where navigation is occurring
 * @param {Promise} action - the awaitable/Promise that triggers the navigation. `element.click()`
 *  for example.
 * @param {array} waitUntilOptions - options passed in to override the default `waitUntil`
 * @return {Promise} a promise that resolves when the trigger and the resulting navigation have all
 *  completed.
 */
export function performNavigationAction(
  tab: Page,
  action: Promise<any>,
  waitUntilOptions?: PuppeteerLifeCycleEvent[]
) {
  return Promise.all([
    action,
    tab.waitForNavigation({ waitUntil: waitUntilOptions ?? waitUntil }),
    // FIXME: Firefox Nightly does not support the waitUntil parameter of waitForNavigation.
    // If that support is ever added, the call below to throttleIfNeeded can be removed.
  ]);
}
