import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const origin = process.env.CARRYLOCK_ORIGIN || "http://127.0.0.1:3000";
const artifactDir = resolve(process.env.CARRYLOCK_BROWSER_ARTIFACTS || "evidence/browser");
const recordVideo = process.env.CARRYLOCK_CAPTURE_VIDEO === "1";
const checkCustomEditor = process.env.CARRYLOCK_CHECK_CUSTOM_EDITOR !== "0";

const cases = [
  { title: /Missing reinstatement/, id: "relief-reinstatement", verdict: "HOLD", asset: "PSV-204", state: "OPEN", finding: "OMITTED_FROM_HANDOVER" },
  { title: /Bypass drops out/, id: "bypass-omitted", verdict: "HOLD", asset: "SIS-118", state: "OPEN", finding: "OMITTED_FROM_HANDOVER" },
  { title: /Permit still suspended/, id: "permit-suspended", verdict: "HOLD", asset: "P-317", state: "CONFLICT", finding: "CONFLICTING_EVIDENCE" },
  { title: /Closure supported/, id: "closure-verified", verdict: "NO_CONFLICT_FOUND", asset: "PSV-416", state: "CLOSED_VERIFIED", finding: "VERIFIED_CLOSURE" },
];

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CARRYLOCK_BROWSER_PATH
    ? { executablePath: process.env.CARRYLOCK_BROWSER_PATH }
    : { channel: "chrome" }),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  ...(recordVideo ? { recordVideo: { dir: artifactDir, size: { width: 1440, height: 1000 } } } : {}),
});
const page = await context.newPage();
const errors = [];
const verified = { origin, checkedAt: new Date().toISOString(), routes: {}, scenarios: [], mobile: [], requests: {} };
page.on("pageerror", (error) => errors.push(error.message));

async function capture(name, target = page, fullPage = true) {
  await target.screenshot({ path: resolve(artifactDir, name), fullPage, animations: "disabled" });
}

async function visit(target, route, heading) {
  const response = await target.goto(new URL(route, origin).href);
  assert.equal(response?.status(), 200, route);
  await target.getByRole("heading", { name: heading, level: 1 }).waitFor();
  await target.evaluate(() => document.fonts.ready);
}

async function chooseScenario(target, scenario) {
  const responsePending = target.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== "/api/review" || response.request().method() !== "POST") return false;
    return response.request().postDataJSON()?.scenarioId === scenario.id;
  });
  const button = target.getByRole("button", { name: scenario.title });
  await button.click();
  const response = await responsePending;
  assert.equal(response.status(), 200, scenario.id);
  const result = await response.json();
  assert.equal(result.review.verdict, scenario.verdict, scenario.id);
  assert.equal(result.receipt.extraction.mode, "synthetic_fixture", scenario.id);
  assert.equal(result.receipt.extraction.fixtureId, scenario.id);
  assert.match(result.receipt.inputHashes.dataset, /^[a-f0-9]{64}$/);
  assert.ok(result.review.findings.some(({ code }) => code === scenario.finding), scenario.finding);
  assert.ok(result.review.obligations.some(({ equipmentId, state }) => equipmentId === scenario.asset && state === scenario.state));
  const results = target.getByRole("region", { name: "Review results" });
  await results.locator(".verdict .badge").filter({ hasText: scenario.verdict.replaceAll("_", " ") }).waitFor();
  await results.getByText(/Synthetic annotations.*No SERV request/).waitFor();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  return { results, result };
}

async function rejectNonFixturePosts(target) {
  await target.route("**/api/review", (route) => {
    const request = route.request();
    if (request.method() === "POST" && !cases.some(({ id }) => id === request.postDataJSON()?.scenarioId)) {
      return route.abort();
    }
    return route.continue();
  });
}

async function checkOverflow(target, viewportWidth, route) {
  const metrics = await target.evaluate(() => ({
    actualWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  const elementWidth = metrics.viewportWidth;
  assert.ok(metrics.actualWidth <= elementWidth + 1, route + " at " + viewportWidth + "px has horizontal overflow: " + JSON.stringify(metrics));
  verified.mobile.push({ route, viewportWidth, ...metrics });
}

async function verifyCustomEditor(target) {
  await target.getByRole("button", { name: "Custom review" }).click();
  const equipment = target.getByRole("group", { name: /Equipment and permits/ });
  await equipment.getByLabel("Equipment ID").fill("SYNTH-A");
  await equipment.getByLabel("Aliases").fill("Synthetic asset A");
  await equipment.getByLabel("Permit IDs").fill("SYNTH-PERMIT-A");
  await equipment.getByRole("button", { name: "Add equipment" }).click();
  await equipment.getByLabel("Equipment ID").nth(1).fill("SYNTH-B");
  await equipment.getByLabel("Aliases").nth(1).fill("Synthetic asset B");
  await equipment.getByLabel("Permit IDs").nth(1).fill("SYNTH-PERMIT-B");
  await equipment.getByRole("button", { name: "Remove equipment 1" }).click();
  assert.equal(await equipment.getByLabel("Equipment ID").inputValue(), "SYNTH-B");
  assert.equal(await equipment.getByLabel("Aliases").inputValue(), "Synthetic asset B");
  assert.equal(await equipment.getByLabel("Permit IDs").inputValue(), "SYNTH-PERMIT-B");

  const register = target.getByRole("group", { name: /Status register/ });
  await register.getByRole("button", { name: "Add register entry" }).click();
  const recordId = register.getByLabel("Record ID");
  await recordId.fill("");
  await recordId.pressSequentially("SYNTH-RECORD", { delay: 35 });
  assert.equal(await recordId.inputValue(), "SYNTH-RECORD");
  assert.ok(await recordId.evaluate((input) => document.activeElement === input));
  verified.customEditor = {
    equipmentRowChangesPreserveDisplayedAliasesAndPermits: true,
    editedRegisterIdRetainsFocus: true,
    inferenceRequestSent: false,
  };
}

try {
  await rejectNonFixturePosts(page);
  const routes = [
    { path: "/", heading: /A hazard doesn.t end because a shift does/, file: "landing.png" },
    { path: "/methodology", heading: /From handover notes to an auditable review/, file: "methodology.png" },
    { path: "/app", heading: "Review workspace", file: "workspace.png" },
  ];
  for (const route of routes) {
    await visit(page, route.path, route.heading);
    verified.routes[route.path] = 200;
    await capture(route.file);
    if (route.path === "/app" && process.env.CARRYLOCK_CHECK_GUIDE === "1") {
      const guide = page.getByRole("region", { name: "The missing relief valve" });
      for (const shift of ["Shift A", "Shift B", "Shift C"]) {
        await guide.getByRole("heading", { name: new RegExp(shift) }).waitFor();
      }
      const button = guide.getByRole("button", { name: "Run the guided synthetic review" });
      await button.focus();
      await page.keyboard.press("Enter");
      await guide.getByRole("status").filter({ hasText: "Review ready" }).waitFor();
      await guide.getByRole("link", { name: "Jump to review results" }).press("Enter");
      assert.equal(new URL(page.url()).hash, "#review-results");
      const historical = page.getByRole("region", { name: /SERV extracted both/ });
      await historical.locator("summary").press("Space");
      await historical.getByText(/chatcmpl-Eke4/).waitFor();
      verified.guide = { keyboard: true, allThreeShifts: true, historicalCompletion: true };

      if (process.env.CARRYLOCK_CHECK_DISABLED_CUSTOM === "1") {
        const health = await (await page.request.get(new URL("/api/review", origin).href)).json();
        assert.equal(health.liveEnabled, false);
        const replay = await page.request.post(new URL("/api/review", origin).href, { data: { scenarioId: "closure-verified" } });
        const { input } = await replay.json();
        const custom = await page.request.post(new URL("/api/review", origin).href, { data: { input } });
        assert.equal(custom.status(), 200);
        const review = await custom.json();
        assert.equal(review.receipt.extraction.serv.attempted, false);
        assert.equal(review.receipt.extraction.serv.status, "disabled");
        assert.equal(review.review.verdict, "REVIEW_REQUIRED");
        verified.customDisabled = { verdict: review.review.verdict, providerStatus: review.receipt.extraction.serv.status };
      }
    }
    if (route.path === "/") {
      await page.screenshot({
        path: resolve(artifactDir, "landing-share.png"),
        clip: { x: 0, y: 0, width: 1440, height: 810 },
        animations: "disabled",
      });
    }
  }

  for (const scenario of cases) {
    const { results, result } = await chooseScenario(page, scenario);
    if (scenario.id === "relief-reinstatement") {
      const omittedShift = page.getByRole("button", { name: /Night shift.*omission/ });
      assert.equal(await omittedShift.getAttribute("aria-pressed"), "true");
      await results.getByText(/No validated evidence extracted for this shift/).waitFor();
      const dayShift = page.getByRole("button", { name: /Day shift.*change/ });
      await dayShift.click();
      assert.equal(await dayShift.getAttribute("aria-pressed"), "true");
      const firstNote = result.review.events.find(({ shiftId, evidence }) => shiftId === "s1" && evidence.source === "shift");
      assert.ok(firstNote);
      await results.locator(".shift-detail blockquote").getByText(firstNote.quote, { exact: false }).waitFor();
      await results.locator(".finding").filter({ hasText: /omitted/i }).locator("summary").click();
      const earlierNote = result.review.events.find(({ shiftId, evidence }) => shiftId === "s2" && evidence.source === "shift");
      assert.ok(earlierNote);
      await results.locator(".finding").filter({ hasText: /omitted/i }).getByText(earlierNote.quote, { exact: false }).waitFor();
      await omittedShift.click();
      assert.equal(await omittedShift.getAttribute("aria-pressed"), "true");
      const downloadPending = page.waitForEvent("download");
      await results.getByRole("button", { name: "JSON receipt" }).click();
      const download = await downloadPending;
      assert.match(download.suggestedFilename(), /^carrylock-review-[a-f0-9]{10}\.json$/);
      const downloadedPath = resolve(artifactDir, "review-receipt.json");
      await download.saveAs(downloadedPath);
      const receipt = JSON.parse(await readFile(downloadedPath, "utf8"));
      assert.equal(receipt.inputHashes.dataset, result.receipt.inputHashes.dataset);
      assert.equal(receipt.verdict, "HOLD");
      assert.ok(receipt.timeline.find(({ shiftId }) => shiftId === "s3").obligations.some(({ omitted }) => omitted));
      assert.equal(receipt.extraction.mode, "synthetic_fixture");
    }
    if (scenario.id === "closure-verified") {
      await results.getByText(/This is not permission to operate/).waitFor();
    }
    await capture(scenario.id + ".png");
    verified.scenarios.push({ id: scenario.id, verdict: result.review.verdict, state: scenario.state, finding: scenario.finding });
    if (recordVideo) await page.waitForTimeout(1300);
  }

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await rejectNonFixturePosts(mobile);
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await visit(mobile, route.path, route.heading);
      await checkOverflow(mobile, width, route.path);
    }
    await chooseScenario(mobile, cases[3]);
    await checkOverflow(mobile, width, "/app (verified closure)");
    if (width === 390) await capture("mobile-closure.png", mobile);
  }
  await mobileContext.close();

  const availability = await context.request.get(new URL("/api/review", origin).href);
  assert.equal(availability.status(), 200);
  const availabilityData = await availability.json();
  assert.equal(typeof availabilityData.liveEnabled, "boolean");
  verified.requests.health = availability.status();
  const badJson = await context.request.post(new URL("/api/review", origin).href, {
    headers: { "Content-Type": "application/json" },
    data: "{",
  });
  assert.equal(badJson.status(), 400);
  verified.requests.invalidJson = badJson.status();
  const badFixture = await context.request.post(new URL("/api/review", origin).href, {
    data: { scenarioId: "absent-synthetic-scenario" },
  });
  assert.equal(badFixture.status(), 404);
  verified.requests.unknownFixture = badFixture.status();

  if (checkCustomEditor) await verifyCustomEditor(page);

  assert.deepEqual(errors, [], "Unexpected JavaScript page errors");
  await writeFile(resolve(artifactDir, "smoke-results.json"), JSON.stringify(verified, null, 2) + "\n");
  const video = page.video();
  await context.close();
  if (recordVideo && video) {
    await video.saveAs(resolve(artifactDir, "carrylock-demo.webm"));
    await video.delete();
  }
  console.log(JSON.stringify(verified, null, 2));
} finally {
  await browser.close();
}
