import { test, expect, type Page } from "@playwright/test";
const base = process.env.TEST_PATH || "/";
async function inference(page: Page) {
  await page
    .getByRole("tab", { name: "Train & Inference", exact: true })
    .click();
}
async function build(page: Page) {
  await page.getByRole("tab", { name: "Build", exact: true }).click();
}
async function example(page: Page) {
  await page.goto(base);
  await page.getByRole("button", { name: "Load engineering example" }).click();
  await expect(page.locator("#build-panel .network-node")).toHaveCount(3);
  await inference(page);
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
}
async function train(page: Page) {
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Trained 3 CPTs" }),
  ).toBeVisible();
}
async function failureTarget(page: Page) {
  const targets = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await targets.getByLabel("Load", { exact: true }).uncheck();
  await targets.getByLabel("Failure", { exact: true }).check();
}
test("CSV → build → training → shared evidence → posterior → save/open → corrupt file", async ({
  page,
}) => {
  const errors: string[] = [],
    remote: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !==
      new URL(process.env.TEST_URL || "http://127.0.0.1:4173").origin
    )
      remote.push(r.url());
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByTestId("csv-file").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Load,Material,Failure\nLow,Steel,No\nLow,Steel,No\nLow,Aluminium,No\nLow,Aluminium,Yes\nHigh,Steel,No\nHigh,Steel,Yes\nHigh,Aluminium,Yes\nHigh,Aluminium,Yes\n",
    ),
  });
  await expect(page.getByText("8 rows · 3 columns")).toBeVisible();
  for (const [i, name] of ["Load", "Material", "Failure"].entries()) {
    await page
      .getByRole("button", { name: `Add ${name}`, exact: true })
      .click();
    await expect(page.locator("#build-panel .network-node")).toHaveCount(i + 1);
  }
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Load" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Failure" });
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Material" });
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await inference(page);
  await page.getByRole("button", { name: "Review training data" }).click();
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
  await train(page);
  await failureTarget(page);
  const evidence = page.getByRole("group", {
    name: "Shared evidence",
    exact: true,
  });
  await evidence
    .getByRole("combobox", { name: "Load", exact: true })
    .selectOption({ label: "High" });
  await evidence
    .getByRole("combobox", { name: "Material", exact: true })
    .selectOption({ label: "Aluminium" });
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".marginal-table")).toContainText("75.000%");
  await expect(page.locator(".probability-node")).toHaveCount(3);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await download;
  await page.getByTestId("project-file").setInputFiles((await file.path())!);
  await expect(page.getByText("Source not attached")).toBeVisible();
  await inference(page);
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("project-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("Could not open");
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
test("cyclic drafts survive embedded save/open and can be repaired in Build", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await example(page);
  await build(page);
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Failure" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Load" });
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cycle detected");
  await page
    .getByRole("checkbox", { name: "Include raw CSV in project download" })
    .check();
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await d;
  await page.getByTestId("project-file").setInputFiles((await file.path())!);
  await expect(page.getByRole("alert")).toContainText("Cycle detected");
  await inference(page);
  await expect(
    page.getByRole("button", { name: "Train model", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run inference", exact: true }),
  ).toBeDisabled();
  await build(page);
  await page
    .getByRole("button", {
      name: "Remove connection Failure to Load",
      exact: true,
    })
    .click();
  await expect(page.locator(".cycle-warning")).toHaveCount(0);
  await inference(page);
  await page.getByRole("button", { name: "Review training data" }).click();
  await expect(
    page.getByRole("button", { name: "Train model", exact: true }),
  ).toBeEnabled();
});
test("numeric cuts, precision-only edits, missing rows and exact-boundary evidence", async ({
  page,
}) => {
  await page.goto(base);
  await page.getByTestId("csv-file").setInputFiles({
    name: "numeric.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Temperature,Material,Failure\n0,Steel,No\n5,Aluminium,No\n10,Steel,Yes\n15,Aluminium,Yes\n,Steel,No\n",
    ),
  });
  for (const [i, name] of ["Temperature", "Material", "Failure"].entries()) {
    await page
      .getByRole("button", { name: `Add ${name}`, exact: true })
      .click();
    await expect(page.locator("#build-panel .network-node")).toHaveCount(i + 1);
  }
  await page
    .getByRole("combobox", { name: "Selected variable", exact: true })
    .selectOption({ label: "Temperature" });
  await page
    .getByRole("combobox", { name: "Binning method", exact: true })
    .selectOption("manual");
  await page
    .getByRole("textbox", { name: "Thresholds (comma-separated)", exact: true })
    .fill("10");
  await page.getByRole("button", { name: "Apply variable settings" }).click();
  await expect(
    page.getByText("2 EFFECTIVE STATES", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Decimal places", exact: true })
    .fill("3");
  await page
    .getByRole("spinbutton", { name: "Decimal places", exact: true })
    .press("Tab");
  await expect(page.locator(".states")).toContainText("[10.000, +∞)");
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Temperature" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Failure" });
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await inference(page);
  await page.getByRole("button", { name: "Review training data" }).click();
  await expect(page.getByText("4 rows retained · 1 excluded")).toBeVisible();
  await train(page);
  const t = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await t.getByLabel("Temperature", { exact: true }).uncheck();
  await t.getByLabel("Failure", { exact: true }).check();
  await page
    .getByRole("spinbutton", {
      name: "Numeric evidence for Temperature",
      exact: true,
    })
    .fill("10");
  await page.getByRole("button", { name: "Map value" }).click();
  await expect(
    page
      .getByRole("group", { name: "Shared evidence", exact: true })
      .getByRole("combobox", { name: "Temperature", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".marginal-table")).toContainText("75.000%");
});
