import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "qa-artifacts/preview-hub";
fs.mkdirSync(OUT, { recursive: true });
const TARGET = pathToFileURL(path.resolve("site/preview/index.html")).href;
const report = { url: TARGET, viewport: "390x844", checks: [], errors: [] };
const pass = (name, data = {}) => {
  report.checks.push({ name, ...data });
  console.log("[HUB-QA]", name, JSON.stringify(data));
};

const browser = await chromium.launch({ headless: true });
try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await mobile.newPage();
  page.on("pageerror", e => report.errors.push(e.message));
  await page.goto(TARGET, { waitUntil: "load" });
  assert.equal(await page.title(), "るみもん");
  assert.equal(await page.locator('[data-access="playable"]').count(), 31);
  assert.equal(await page.locator('#beginning [data-access="playable"]').count(), 20);
  assert.equal(await page.locator('#memory [data-access="playable"]').count(), 2);
  assert.equal(await page.locator('#world [data-access="playable"]').count(), 5);
  assert.equal(await page.locator('#references [data-access="playable"]').count(), 4);
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 31);
  assert.equal(await page.locator('a.main-action').count(), 1);
  await page.screenshot({ path: OUT + "/01-mobile-cover.png" });
  pass("mobile-sections-and-game-links", { visiblePlayables: 31 });

  const bounds = await page.evaluate(() => {
    const vw = innerWidth;
    const entries = [...document.querySelectorAll(".catalog-entry[data-access='playable']")];
    const outliers = entries.map(el => {
      const r = el.getBoundingClientRect();
      return { title: el.querySelector("strong")?.textContent, left: r.left, right: r.right, height: r.height };
    }).filter(x => x.left < -1 || x.right > vw + 1 || x.height < 44);
    return {
      vw, docWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      outliers,
      viewportFit: document.querySelector('meta[name="viewport"]')?.content,
    };
  });
  assert.ok(bounds.docWidth <= 391, "document horizontally overflows 390px: " + JSON.stringify(bounds));
  assert.ok(bounds.outliers.length === 0, "clipped/tiny playable links: " + JSON.stringify(bounds.outliers));
  assert.ok(bounds.viewportFit?.includes("viewport-fit=cover"), "safe-area viewport meta absent");
  pass("mobile-layout-and-tap-targets", bounds);

  await page.locator('a[href="#beginning"]').click();
  await page.locator("#beginning").scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "/02-mobile-beginning.png" });
  assert.ok((await page.locator("#beginning .entry-status").allTextContents()).includes("不採用"));
  assert.ok((await page.locator("#beginning .entry-status").allTextContents()).includes("比較基準・未完成"));
  pass("beginning-review-labels");

  await page.locator("#catalog-search").fill("水辺");
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 1);
  assert.equal(await page.locator('#beginning [data-access="playable"]:visible strong').first().textContent(), "水辺・暮らし版");
  await page.screenshot({ path: OUT + "/03-mobile-search.png" });
  pass("search-water", { result: await page.locator("#catalog-count").textContent() });

  await page.locator("#catalog-search").fill("");
  assert.equal(await page.locator('[data-access="playable"]:visible').count(), 31);
  assert.equal(await page.locator('[data-access="source-only"]').count(), 4);
  pass("search-clear-restores-all", { visible: 31 });

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const dpage = await desktop.newPage();
  await dpage.goto(TARGET, { waitUntil: "load" });
  assert.equal(await dpage.locator('[data-access="playable"]:visible').count(), 31);
  const dw = await dpage.evaluate(() => ({ vw: innerWidth, docWidth: document.documentElement.scrollWidth }));
  assert.ok(dw.docWidth <= dw.vw + 1, "desktop horizontal overflow");
  await dpage.screenshot({ path: OUT + "/04-desktop-cover.png" });
  pass("desktop-smoke", dw);

  assert.equal(report.errors.length, 0, "page errors: " + report.errors.join("; "));
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
