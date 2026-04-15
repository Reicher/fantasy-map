import { expect, test, type Page } from "@playwright/test";

test.describe("visual baseline", () => {
  test("play mode map canvas", async ({ page }) => {
    await page.goto("/");
    await waitForPlayReady(page);
    await regenerateWorld(page, "visual-play-seed");
    await waitForPlayReady(page);
    await page.locator("#play-switch-mode").click();
    await expect(page.locator("#play-canvas")).toBeVisible();
    await expect(page.locator("#play-canvas")).toHaveScreenshot(
      "play-map-initial.png",
      {
        animations: "disabled",
      },
    );
  });

  test("editor mode canvas", async ({ page }) => {
    await page.goto("/?mode=editor");
    await waitForEditorReady(page);
    await regenerateWorld(page, "visual-editor-seed");
    await waitForEditorReady(page);
    await expect(page.locator("#map-canvas")).toHaveScreenshot(
      "editor-map-initial.png",
      {
        animations: "disabled",
      },
    );
  });
});

async function waitForPlayReady(page: Page) {
  const loading = page.locator("#play-loading");
  await page.locator("#play-view").waitFor({ state: "visible" });
  await loading.waitFor({ state: "attached" });
  await expect(loading).toBeHidden();
}

async function waitForEditorReady(page: Page) {
  const loading = page.locator("#editor-loading");
  await page.locator("#editor-shell").waitFor({ state: "visible" });
  await loading.waitFor({ state: "attached" });
  await expect(loading).toBeHidden();
}

async function regenerateWorld(page: Page, seed: string) {
  await page.evaluate((nextSeed) => {
    const seedInput = document.querySelector("#seed");
    if (seedInput instanceof HTMLInputElement) {
      seedInput.value = nextSeed;
    }
    const form = document.querySelector("#controls");
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
    }
  }, seed);
}
