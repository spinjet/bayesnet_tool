import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const base = process.env.TEST_PATH || "/";
async function load(page: Page) {
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByRole("button", { name: "Load engineering example" }).click();
  await expect(page.getByRole("status")).toContainText("Example ready");
}
async function analysis(page: Page) {
  await page
    .getByRole("tab", { name: "Train & Inference", exact: true })
    .click();
}
async function build(page: Page) {
  await page.getByRole("tab", { name: "Build", exact: true }).click();
}
async function train(page: Page) {
  await page.getByRole("button", { name: "Review training data" }).click();
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Trained 3 CPTs");
}
async function run(page: Page) {
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
}
test("branding, state aliases, uniform CPT training and presentation-only edits", async ({
  page,
}) => {
  await load(page);
  await expect(page).toHaveTitle("PDOPT-BN");
  await expect(
    page.getByRole("tab", { name: "Build", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("group", { name: "Shared evidence", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "Selected variable", exact: true })
    .selectOption({ label: "Failure" });
  await page
    .getByRole("textbox", { name: "State display name for No", exact: true })
    .fill("Operational");
  await page
    .getByRole("textbox", { name: "State display name for Yes", exact: true })
    .fill("Failed");
  await page.getByRole("button", { name: "Apply state names" }).click();
  await page
    .getByRole("combobox", { name: "Parameter mode", exact: true })
    .selectOption("uniform");
  await analysis(page);
  await expect(
    page.getByRole("button", { name: "Run inference", exact: true }),
  ).toBeDisabled();
  await train(page);
  const targets = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await targets.getByLabel("Load", { exact: true }).uncheck();
  await targets.getByLabel("Failure", { exact: true }).check();
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
  await run(page);
  await expect(page.locator(".marginal-table")).toContainText("Operational");
  await expect(page.locator(".marginal-table")).toContainText("50.000%");
  await expect(
    page
      .locator(".probability-node")
      .filter({ has: page.locator("strong", { hasText: "Failure" }) }),
  ).toContainText("Uniform CPT");
  await build(page);
  await page
    .getByRole("textbox", { name: "State display name for No", exact: true })
    .fill("Working");
  await page.getByRole("button", { name: "Apply state names" }).click();
  await analysis(page);
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".marginal-table")).toContainText("Working");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await download;
  const saved = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(saved.schemaVersion).toBe(2);
  const v = saved.variables.find((v: any) => v.label === "Failure");
  expect(v.states).toEqual(["No", "Yes"]);
  expect(v.stateLabels).toEqual(["Working", "Failed"]);
  const c = saved.cpts.find((c: any) => c.variableId === v.id);
  expect(c.origin).toBe("uniform");
  expect(c.values.every((p: number) => p === 0.5)).toBe(true);
  expect(c.counts.reduce((a: number, b: number) => a + b, 0)).toBe(8);
  await build(page);
  await page
    .getByRole("textbox", { name: "State display name for Yes", exact: true })
    .fill("Working");
  await page.getByRole("button", { name: "Apply state names" }).click();
  await expect(page.getByRole("alert")).toContainText("unique");
  await analysis(page);
  await expect(
    evidence
      .getByRole("combobox", { name: "Failure", exact: true })
      .getByRole("option", { name: "Failed", exact: true }),
  ).toHaveCount(1);
});
test("joint heatmaps, tabbed groups, higher-dimensional filters and exports", async ({
  page,
}) => {
  await load(page);
  await analysis(page);
  await train(page);
  const targets = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await targets.getByLabel("Failure", { exact: true }).check();
  await page
    .getByRole("textbox", { name: "Query name", exact: true })
    .fill("Load × Failure");
  await page
    .getByRole("textbox", { name: "Query name", exact: true })
    .press("Tab");
  await run(page);
  await expect(page.locator(".joint-heatmap")).toContainText("31.250%");
  await expect(
    page.getByRole("button", { name: "Run inference", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Train model", exact: true }),
  ).toBeInViewport();
  await expect(page.locator(".probability-node")).toHaveCount(3);
  await page.getByRole("button", { name: "＋ Add query", exact: true }).click();
  await targets.getByLabel("Material", { exact: true }).check();
  await targets.getByLabel("Failure", { exact: true }).check();
  await run(page);
  await expect(page.locator(".combination-table tbody tr")).toHaveCount(8);
  const filters = page.getByRole("group", {
    name: "Filter combinations",
    exact: true,
  });
  await filters
    .getByRole("combobox", { name: "Material", exact: true })
    .selectOption({ label: "Steel" });
  await expect(page.locator(".combination-table tbody tr")).toHaveCount(4);
  await expect(page.getByText(/Displayed probability mass:/)).toContainText(
    "50.000%",
  );
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const json = JSON.parse(
    await readFile((await (await jsonDownload).path())!, "utf8"),
  );
  expect(json.posterior).toHaveLength(8);
  expect(json.posterior.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(
    1,
    10,
  );
  expect(json.provenance.group.targetIds).toHaveLength(3);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await readFile((await (await csvDownload).path())!, "utf8");
  expect(csv.split("\r\n")).toHaveLength(9);
  expect(csv).toContain("stateId");
  await page.getByRole("tab", { name: "Load × Failure", exact: true }).click();
  await expect(page.locator(".joint-heatmap")).toBeVisible();
  await page
    .getByRole("group", { name: "Shared evidence", exact: true })
    .getByRole("combobox", { name: "Material", exact: true })
    .selectOption({ label: "Aluminium" });
  await expect(
    page.getByRole("button", { name: "Export JSON", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".probability-graph")).toContainText("Outdated");
  await run(page);
  await expect(page.locator(".joint-heatmap")).toContainText("37.500%");
  await page
    .getByRole("slider", { name: "Results area height", exact: true })
    .fill("75");
  await expect(page.getByText("75% results / 25% controls")).toBeVisible();
});

test("v1 projects migrate to query views without changing saved CPTs", async ({
  page,
}) => {
  await load(page);
  await analysis(page);
  await train(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const download = await downloadPromise;
  const old = JSON.parse(await readFile((await download.path())!, "utf8"));
  old.schemaVersion = 1;
  old.targetIds = old.variables.map((v: any) => v.id);
  delete old.queryGroups;
  for (const v of old.variables) {
    delete v.stateLabels;
    delete v.displayDecimals;
    delete v.parameterMode;
  }
  for (const c of old.cpts)
    c.signature = JSON.stringify(JSON.parse(c.signature).slice(0, 3));
  const values = old.cpts.map((c: any) => c.values);
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(page.getByText("Source not attached")).toBeVisible();
  await analysis(page);
  await expect(page.locator(".query-tabs [role=tab]")).toHaveCount(3);
  await run(page);
  await expect(page.locator(".probability-node")).toHaveCount(3);
  const savedPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const savedDownload = await savedPromise;
  const saved = JSON.parse(
    await readFile((await savedDownload.path())!, "utf8"),
  );
  expect(saved.schemaVersion).toBe(2);
  expect(saved.cpts.map((c: any) => c.values)).toEqual(values);
  expect(saved.queryGroups).toHaveLength(3);
});
