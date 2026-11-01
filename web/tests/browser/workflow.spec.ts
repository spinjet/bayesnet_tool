import { test, expect } from "@playwright/test";
const base = process.env.TEST_PATH || "/";
test("CSV → graph → train → multi-evidence marginals → portable save/open → corrupt file", async ({
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
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "sample.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Load,Material,Failure\nLow,Steel,No\nLow,Steel,No\nLow,Aluminium,No\nLow,Aluminium,Yes\nHigh,Steel,No\nHigh,Steel,Yes\nHigh,Aluminium,Yes\nHigh,Aluminium,Yes\n",
      ),
    });
  await expect(page.getByText("8 rows · 3 columns")).toBeVisible();
  for (const name of ["Load", "Material", "Failure"]) {
    await page
      .getByRole("button", { name: `Add ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `Add ${name}`, exact: true }),
    ).toBeDisabled();
  }
  await page.getByText("Connections · keyboard controls").click();
  const connection = page.locator(".connection-controls");
  await connection
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Load" });
  await connection
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Failure" });
  await connection
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await connection
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Material" });
  await connection
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByRole("button", { name: "Train CPTs", exact: true }).click();
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Trained 3 CPTs" }),
  ).toBeVisible();
  const evidence = page.getByRole("group", { name: "Shared evidence" });
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
  const card = page.locator(".result-card").filter({
    has: page.getByRole("heading", { name: "Failure", exact: true }),
  });
  await expect(card).toContainText("75.00%");
  expect(await page.locator(".result-card").count()).toBe(3);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page.locator("input[type=file]").nth(1).setInputFiles(path!);
  await expect(page.getByText("Source not attached")).toBeVisible();
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  await expect(page.getByRole("alert")).toContainText("Could not open");
  await expect(
    page.getByRole("heading", { name: "Build your network" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
test("cycles stay editable, block training, and can be repaired", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByRole("button", { name: "Load engineering example" }).click();
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "Train CPTs", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run inference", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Include raw CSV in project download" })
    .check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const download = await downloadPromise;
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles((await download.path())!);
  await expect(
    page.getByText("Source attached", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Cycle detected");
  await c
    .getByRole("button", {
      name: "Remove connection Failure to Load",
      exact: true,
    })
    .click();
  await expect(page.locator(".cycle-warning")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Train CPTs", exact: true }),
  ).toBeEnabled();
});
test("mixed numeric data: manual bin boundaries, missing-row review and numeric evidence", async ({
  page,
}) => {
  await page.goto(base);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "numeric.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Temperature,Material,Failure\n0,Steel,No\n5,Aluminium,No\n10,Steel,Yes\n15,Aluminium,Yes\n,Steel,No\n",
      ),
    });
  for (const name of ["Temperature", "Material", "Failure"]) {
    await page
      .getByRole("button", { name: `Add ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `Add ${name}`, exact: true }),
    ).toBeDisabled();
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
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Temperature" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Failure" });
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Train CPTs", exact: true }).click();
  await expect(page.getByText("4 rows retained · 1 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Trained 3 CPTs" }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", {
      name: "Numeric evidence for Temperature",
      exact: true,
    })
    .fill("10");
  await page.getByRole("button", { name: "Map value" }).click();
  await expect(
    page
      .getByRole("group", { name: "Shared evidence" })
      .getByRole("combobox", { name: "Temperature", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  const card = page.locator(".result-card").filter({
    has: page.getByRole("heading", { name: "Failure", exact: true }),
  });
  await expect(card).toContainText("75.00%");
});
