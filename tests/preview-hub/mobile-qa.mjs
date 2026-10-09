import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "qa-artifacts/preview-hub";
fs.mkdirSync(OUT, { recursive: true });
const TARGET = pathToFileURL(path.resolve("site/preview/index.html")).href;
const report = { url: TARGET, viewports: ["390x844", "1280x720"], checks: [], errors: [] };
const pass = (name, data = {}) => {
  report.checks.push({ name, ...data });
  console.log("[HUB-QA]", name, JSON.stringify(data));
};
const browser = await chromium.launch({ headless: true });
try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await mobile.newPage();
  page.on("pageerror", e => report.errors.push("pageerror: " + e.message));
  await page.goto(TARGET, { waitUntil: "load" });
  assert.equal(await page.title(), "るみもん");
  assert.equal(await page.locator('a.main-action').count(), 1);
  assert.equal(await page.locator('[data-access="playable"]').count(), 26);
  assert.equal(await page.locator('[data-vault]').count(), 3);
  assert.equal(await page.locator('[data-vault][open]').count(), 0);
  assert.equal(await page.locator('[data-vault] [data-access="playable"]').count(), 21);
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 5);
  assert.equal(await page.locator('#archive-rejected').count(), 0);
  assert.equal(await page.locator('[data-status="rejected"]').count(), 0);
  assert.equal(await page.locator('#now [data-status="reviewed"]').count(), 1);
  assert.equal(await page.locator('#standards [data-status="golden"]').count(), 2);
  await page.screenshot({ path: OUT + "/01-mobile-cover.png" });
  pass("first-glance-has-five-playables-plus-work", { visible: 5, archived: 21, excludedFromHub: 5 });

  const bounds = await page.evaluate(() => {
    const vw = innerWidth;
    const elements = [...document.querySelectorAll(
      '.catalog-entry[data-access="playable"]:not([hidden]), .vault summary, .page-jumps a, .main-action, input'
    )].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
    const outliers = elements.map(el => {
      const r = el.getBoundingClientRect();
      return { name: el.textContent?.trim().slice(0, 30), left: r.left, right: r.right, height: r.height };
    }).filter(x => x.left < -1 || x.right > vw + 1 || x.height < 44);
    return {
      vw, docWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      outliers,
      viewportFit: document.querySelector('meta[name="viewport"]')?.content,
    };
  });
  assert.ok(bounds.docWidth <= bounds.vw + 1, "mobile horizontal overflow: " + JSON.stringify(bounds));
  assert.equal(bounds.outliers.length, 0, "clipped/small mobile targets: " + JSON.stringify(bounds.outliers));
  assert.ok(bounds.viewportFit?.includes("viewport-fit=cover"), "safe-area viewport meta missing");
  pass("390px-layout-and-targets", bounds);

  await page.locator('a[href="#now"]').click();
  await page.locator("#now").scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "/02-mobile-current-versions.png" });
  assert.equal(await page.locator('#now [data-status="reviewed"]:visible').count(), 1);
  pass("reviewed-baseline-is-upfront");

  await page.locator("#catalog-search").fill("水辺");
  assert.equal(await page.locator('#archive-proposals').evaluate(x => x.open), true);
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 1);
  assert.equal(await page.locator('#archive-proposals [data-access="playable"]:visible strong').first().textContent(), "水辺・暮らし版");
  assert.equal(await page.locator('#archive-rejected').count(), 0);
  await page.screenshot({ path: OUT + "/03-mobile-search.png" });
  pass("search-opens-matching-past-proposal", { text: await page.locator("#catalog-count").textContent() });

  await page.locator("#catalog-search").fill("");
  assert.equal(await page.locator('[data-vault][open]').count(), 0);
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 5);
  pass("search-clear-restores-closed-archives");


  await page.locator("#catalog-search").fill("23×17");
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 0);
  assert.equal(await page.locator("#archive-rejected").count(), 0);
  assert.equal(await page.locator("#catalog-count").textContent(), "一致する版は見つからなかったよ");
  await page.locator("#catalog-search").fill("");
  assert.equal(await page.locator('[data-vault][open]').count(), 0);
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 5);
  assert.equal(await page.locator("#catalog-count").textContent(), "26件のプレイ用保存版を保管中");
  pass("user-dismissed-rejected-variants-do-not-appear-or-search");

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const dpage = await desktop.newPage();
  dpage.on("pageerror", e => report.errors.push("desktop pageerror: " + e.message));
  await dpage.goto(TARGET, { waitUntil: "load" });
  assert.equal(await dpage.locator('[data-access="playable"]:visible').count(), 5);
  const dw = await dpage.evaluate(() => ({ vw: innerWidth, docWidth: document.documentElement.scrollWidth }));
  assert.ok(dw.docWidth <= dw.vw + 1, "desktop horizontal overflow");
  await dpage.screenshot({ path: OUT + "/05-desktop-cover.png" });
  pass("desktop-viewport", dw);

  assert.equal(report.errors.length, 0, "errors: " + report.errors.join("; "));
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.errors.push(String(error.stack || error));
  console.error(error);
} finally {
  report.finished = new Date().toISOString();
  fs.writeFileSync(OUT + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
if (!report.ok) process.exitCode = 1;
