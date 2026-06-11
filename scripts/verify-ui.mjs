import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const outputDir = "artifacts/screenshots";

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ channel: "chrome", headless: true }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function verifyViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(900);

  const stats = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "missing canvas" };

    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "missing webgl context" };

    const width = canvas.width;
    const height = canvas.height;
    const x = 0;
    const y = 0;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nonDark = 0;
    let colorEnergy = 0;
    const unique = new Set();

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      const energy = red + green + blue;
      colorEnergy += energy;
      if (alpha > 0 && energy > 30) nonDark += 1;
      if (index % 64 === 0) unique.add(`${red},${green},${blue},${alpha}`);
    }

    return {
      ok: nonDark > 80 && unique.size > 6,
      nonDark,
      unique: unique.size,
      averageEnergy: Math.round(colorEnergy / (pixels.length / 4)),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  });

  if (!stats.ok) {
    throw new Error(`${name} canvas check failed: ${JSON.stringify(stats)}`);
  }

  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
  await page.close();
  return stats;
}

await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser();
try {
  const desktop = await verifyViewport(browser, "desktop", { width: 1440, height: 920 });
  const mobile = await verifyViewport(browser, "mobile", { width: 390, height: 844 });
  const mobileLandscape = await verifyViewport(browser, "mobile-landscape", { width: 844, height: 390 });
  console.log("UI verification passed");
  console.log({ desktop, mobile, mobileLandscape });
} finally {
  await browser.close();
}
