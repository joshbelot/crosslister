import { afterEach, describe, expect, it } from 'vitest';
import { browserMode, chromeArgs, chromeCandidates } from '../../src/server/browser/browserManager';

describe('browser manager helpers', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['CROSSLISTER_BROWSER_MODE', 'CROSSLISTER_HEADLESS', 'CROSSLISTER_CHROMIUM_PATH', 'CROSSLISTER_CHROME_HEADLESS']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  it('chooses attach by default and launch for tests', () => {
    delete process.env.CROSSLISTER_BROWSER_MODE;
    delete process.env.CROSSLISTER_HEADLESS;
    delete process.env.CROSSLISTER_CHROMIUM_PATH;
    expect(browserMode()).toBe('attach');
    process.env.CROSSLISTER_HEADLESS = '1';
    expect(browserMode()).toBe('launch');
    delete process.env.CROSSLISTER_HEADLESS;
    process.env.CROSSLISTER_CHROMIUM_PATH = '/x/chromium';
    expect(browserMode()).toBe('launch');
    process.env.CROSSLISTER_BROWSER_MODE = 'attach';
    expect(browserMode()).toBe('attach');
    process.env.CROSSLISTER_BROWSER_MODE = 'launch';
    expect(browserMode()).toBe('launch');
  });

  it('passes only the allowed switches to Chrome', () => {
    delete process.env.CROSSLISTER_CHROME_HEADLESS;
    expect(chromeArgs('/tmp/p', 9333)).toEqual([
      '--user-data-dir=/tmp/p', '--remote-debugging-port=9333', '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,900', 'about:blank',
    ]);
    process.env.CROSSLISTER_CHROME_HEADLESS = '1';
    expect(chromeArgs('/tmp/p', 9333)).toContain('--headless=new');
  });

  it('knows where Chrome lives on macOS', () => {
    expect(chromeCandidates('darwin', '/Users/x')).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/x/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  });
});
