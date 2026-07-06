import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const appUrl = process.env.MIND_ATLAS_STAGING_URL || "http://127.0.0.1:8088/";
const verifyEmail = process.env.MIND_ATLAS_STAGING_VERIFY_EMAIL || "openceo99@gmail.com";
const expectedServices = (process.env.MIND_ATLAS_EXPECTED_STAGING_CHAT_SERVICES || "openai,anthropic,deepseek")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const token = createSessionToken(verifyEmail);
const browser = await launchBrowser();

try {
  const url = new URL(appUrl);
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await context.addCookies([{
    name: "ma_session",
    value: token,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).waitFor();

  const serviceSelect = page.locator(".chat-options-row select").first();
  await serviceSelect.waitFor();
  const serviceOptions = await serviceSelect.locator("option").evaluateAll((options) => options.map((option) => option.value));
  const modelOptions = await page.locator(".chat-options-row select").nth(1).locator("option").evaluateAll((options) => options.slice(0, 8).map((option) => option.value));
  const aiButtonText = cleanText(await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).textContent());

  if (JSON.stringify(serviceOptions) !== JSON.stringify(expectedServices)) {
    throw new Error(`Expected chat services ${JSON.stringify(expectedServices)}, got ${JSON.stringify(serviceOptions)}`);
  }

  await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).click();
  await page.locator(".ai-feature-dialog").waitFor();
  await page.locator(".ai-usage-guide-card").waitFor();
  await page.locator(".ai-credit-card strong").waitFor();
  await page.locator(".ai-credit-renewal", { hasText: "次回更新日:" }).waitFor();

  console.log("Live staging UI verification passed");
  console.log(JSON.stringify({ aiButtonText, serviceOptions, modelOptions }, null, 2));
} finally {
  await browser.close();
}

function createSessionToken(email) {
  const script = [
    "import { createSession, findUserByEmail } from './server/service-db.mjs';",
    `const user = await findUserByEmail(${JSON.stringify(email)});`,
    "if (!user) { console.error('verify user not found'); process.exit(1); }",
    "const token = await createSession(user.id, 1);",
    "process.stdout.write(token);",
    "process.exit(0);",
  ].join(" ");
  return execFileSync("docker", [
    "compose",
    "-f",
    "docker-compose.staging.yml",
    "-f",
    "docker-compose.staging.local.yml",
    "exec",
    "-T",
    "app",
    "node",
    "--input-type=module",
    "-e",
    script,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

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

async function seedCompletedOnboarding(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "mind-atlas-onboarding-v1",
      JSON.stringify({
        version: 1,
        firstRun: false,
        rootNodeCreated: true,
        pan: true,
        zoom: true,
        nodeDrag: true,
        childNodeCreated: true,
        spaceBasicsCompleted: true,
        basicCompleted: true,
        aiUnlocked: true,
        titlePromptApplied: true,
        startedAt: now,
        completedAt: now,
      }),
    );
  });
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
