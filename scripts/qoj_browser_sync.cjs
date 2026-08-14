#!/usr/bin/env node
/**
 * Automated QOJ problem status scraper using Puppeteer / Chrome DevTools.
 *
 * Usage:
 *   node scripts/qoj_browser_sync.cjs --handle Dedibeat
 *   node scripts/qoj_browser_sync.cjs --handle Dedibeat --api http://127.0.0.1:8000 --token "<JWT>"
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const args = process.argv.slice(2);

function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const handle = getArg('--handle') || process.env.QOJ_HANDLE;
const apiBase = getArg('--api', process.env.VITE_API_BASE || 'http://127.0.0.1:8000');
const token = getArg('--token', process.env.AUTH_TOKEN);
const cookieStr = getArg('--cookie', process.env.QOJ_COOKIES);

if (!handle) {
  console.error('Error: --handle is required (e.g. node scripts/qoj_browser_sync.cjs --handle Dedibeat)');
  process.exit(1);
}

(async () => {
  console.log(`[QOJ Sync] Starting automated Chrome scraper for user: ${handle}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');

    if (cookieStr) {
      const cookiePairs = cookieStr.split(';').map(c => c.trim()).filter(Boolean);
      for (const pair of cookiePairs) {
        const [name, ...val] = pair.split('=');
        if (name && val.length) {
          await page.setCookie({
            name: name.trim(),
            value: val.join('=').trim(),
            domain: '.qoj.ac',
            path: '/',
          });
        }
      }
    }

    const profileUrl = `https://qoj.ac/user/profile/${encodeURIComponent(handle)}`;
    console.log(`[QOJ Sync] Navigating to: ${profileUrl}`);

    await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const title = await page.title();
    if (title.includes('Login') || title.includes('Just a moment')) {
      console.error(`[QOJ Sync] Failed to access profile (Title: "${title}"). Authentication cookie required.`);
      process.exit(1);
    }

    const data = await page.evaluate(() => {
      const html = document.body.innerHTML;

      function parseProblems(keyword, endKeyword) {
        const start = html.indexOf(keyword);
        if (start === -1) return [];
        const end = endKeyword ? html.indexOf(endKeyword, start) : -1;
        const slice = end !== -1 ? html.slice(start, end) : html.slice(start);
        const matches = [...slice.matchAll(/\/problem\/(\d+)/g)];
        return matches.map(m => parseInt(m[1], 10));
      }

      const accepted = parseProblems('Accepted problems', 'Tried problems');
      const tried = parseProblems('Tried problems', 'Authored problems');

      return {
        accepted: [...new Set(accepted)],
        tried: [...new Set(tried)],
        cookies: document.cookie,
      };
    });

    console.log(`[QOJ Sync] Scraped ${data.accepted.length} accepted problems, ${data.tried.length} tried problems.`);

    if (token) {
      console.log(`[QOJ Sync] Pushing to API: ${apiBase}/api/qoj-sync`);
      const res = await fetch(`${apiBase}/api/qoj-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          handle,
          cookies: cookieStr || data.cookies,
          solved: data.accepted,
          attempted: data.tried,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[QOJ Sync] API error (${res.status}): ${err}`);
      } else {
        const result = await res.json();
        console.log(`✓ [QOJ Sync] Successfully synced!`, result);
      }
    } else {
      console.log(`[QOJ Sync] Output JSON:`, JSON.stringify({
        handle,
        solvedCount: data.accepted.length,
        attemptedCount: data.tried.length,
        solved: data.accepted,
        attempted: data.tried,
      }, null, 2));
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error('[QOJ Sync] Error:', e.message);
  process.exit(1);
});
