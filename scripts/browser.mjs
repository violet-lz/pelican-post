import { chromium } from 'playwright';

export function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.PELICAN_CHROME_PATH
      ? { executablePath: process.env.PELICAN_CHROME_PATH }
      : { channel: process.env.PELICAN_BROWSER_CHANNEL ?? 'chrome' }),
  });
}
