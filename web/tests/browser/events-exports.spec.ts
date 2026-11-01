import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_PATH || "/";
async function init(page: Page) {
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByTestId("csv-file").setInputFiles({
    name: "events.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Temperature,Output\n0,no\n5,no\n10,yes\n15,yes\n20,yes\n",
    ),
  });
  for (const label of ["Temperature", "Output"])
    await page
      .getByRole("button", { name: `Add ${label}`, exact: true })
      .click();
  await page
    .getByRole("combobox", { name: "Selected variable", exact: true })
    .selectOption({ label: "Temperature" });
  await page
    .getByRole("combobox", { name: "Binning method", exact: true })
    .selectOption("manual");
  await page
    .getByRole("textbox", { name: "Thresholds (comma-separated)", exact: true })
    .fill("5, 15");
  await page.getByRole("button", { name: "Apply variable settings" }).click();
  await expect(
    page.getByText("3 EFFECTIVE STATES", { exact: true }),
  ).toBeVisible();
}
async function train(page: Page) {
  await page.getByRole("button", { name: "Review training data" }).click();
  await expect(page.getByText("5 rows retained · 0 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Trained 2 CPTs");
}
async function run(page: Page) {
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
}
test("four-side connections, exact numeric events, image and dependent sample downloads remain local", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== "127.0.0.1")
      external.push(r.url());
  });
  await init(page);
  const handles = page
    .locator("#build-panel .vue-flow__node")
    .first()
    .locator(".vue-flow__handle");
  await expect(handles).toHaveCount(4);
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Temperature" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Output" });
  await c
    .getByRole("combobox", { name: "From side", exact: true })
    .selectOption("top");
  await c
    .getByRole("combobox", { name: "To side", exact: true })
    .selectOption("bottom");
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("tab", { name: "Train & Inference", exact: true })
    .click();
  await train(page);
  const targets = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await targets.getByLabel("Output", { exact: true }).check();
  const event = page.locator(".evidence-control").first();
  await event.locator("summary").click();
  await event
    .getByRole("spinbutton", { name: "Threshold for Temperature", exact: true })
    .fill("7");
  await event.getByRole("button", { name: "Apply threshold" }).click();
  await expect(
    page.getByRole("button", { name: "Run inference", exact: true }),
  ).toBeDisabled();
  await event.getByRole("button", { name: "Add exact cut & retrain" }).click();
  await expect(
    page
      .getByText("Train CPTs for the current model before inference.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await train(page);
  await run(page);
  await expect(
    page.locator("#inference-panel .network-node").first(),
  ).toContainText("0.0%");
  await page.getByText("Sample queried distribution", { exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Sample count", exact: true })
    .fill("100");
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download samples ZIP" }).click();
  const zip = unzipSync(await readFile((await (await zipPromise).path())!));
  const meta = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(meta.count).toBe(100);
  expect(meta.evidence[meta.columns[0].variableId]).toMatchObject({
    kind: "threshold",
    value: 7,
  });
  expect(strFromU8(zip["samples.csv"]).split("\r\n")).toHaveLength(101);
  await page.getByText("Export network image", { exact: true }).click();
  await page.getByLabel("Include current probabilities").check();
  const svgPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download network image" }).click();
  const svg = await readFile((await (await svgPromise).path())!, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("%");
  expect(svg).not.toContain("__event_");
  await page.getByLabel("Image format", { exact: true }).selectOption("png");
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download network image" }).click();
  const png = await readFile((await (await pngPromise).path())!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const savePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await savePromise).path())!, "utf8"),
  );
  expect(saved.schemaVersion).toBe(3);
  expect(saved.edges[0]).toMatchObject({
    sourceHandle: "top",
    targetHandle: "bottom",
  });
  expect(external).toEqual([]);
});
test("categorical allowed-state selection invalidates old results and can be cleared", async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole("button", { name: "Load engineering example" }).click();
  await page
    .getByRole("tab", { name: "Train & Inference", exact: true })
    .click();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Trained 3 CPTs");
  await run(page);
  const event = page.locator(".evidence-control").first();
  await event.locator("summary").click();
  await event.getByRole("listbox").selectOption(["0", "1"]);
  await expect(
    page.getByText("Outdated results", { exact: true }),
  ).toBeVisible();
  await run(page);
  await event.getByRole("listbox").selectOption(["1"]);
  await run(page);
  await page
    .getByRole("button", { name: "Clear evidence", exact: true })
    .click();
  await run(page);
});

test("top-to-bottom pointer connections preserve parent-to-child direction", async ({
  page,
}) => {
  await init(page);
  const nodes = page.locator("#build-panel .vue-flow__node");
  const source = await nodes
      .nth(0)
      .locator(".vue-flow__handle-top")
      .boundingBox(),
    target = await nodes
      .nth(1)
      .locator(".vue-flow__handle-bottom")
      .boundingBox();
  expect(source).toBeTruthy();
  expect(target).toBeTruthy();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect(page.locator("#build-panel .vue-flow__edge")).toHaveCount(1);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await save).path())!, "utf8"),
  );
  expect(saved.edges[0]).toMatchObject({
    source: saved.variables[0].id,
    target: saved.variables[1].id,
    sourceHandle: "top",
    targetHandle: "bottom",
  });
});
for (const operation of ["graph", "sample"] as const)
  test(`${operation} export cancellation or stale response preserves inference and permits retry`, async ({
    page,
  }) => {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Load engineering example" })
      .click();
    await page
      .getByRole("tab", { name: "Train & Inference", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Train model", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Trained 3 CPTs");
    await run(page);
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      requested = new Promise<void>((r) => (started = r));
    const pattern =
      operation === "graph" ? "**/graph-export-*.js" : "**/sampling-*.js";
    await page.route(pattern, async (route) => {
      started();
      await barrier;
      await route.continue().catch(() => {});
    });
    await page
      .getByText(
        operation === "graph"
          ? "Export network image"
          : "Sample queried distribution",
        { exact: true },
      )
      .click();
    const button = page.getByRole("button", {
      name:
        operation === "graph"
          ? "Download network image"
          : "Download samples ZIP",
      exact: true,
    });
    await button.click();
    await requested;
    if (operation === "graph")
      await page
        .getByRole("button", { name: "Cancel computation", exact: true })
        .click();
    else
      await page
        .getByRole("group", { name: "Shared evidence", exact: true })
        .getByRole("combobox", { name: "Load", exact: true })
        .selectOption({ label: "High" });
    release();
    await expect(page.getByRole("alert")).toContainText(
      operation === "graph" ? "cancelled" : "outdated",
    );
    await page.unroute(pattern);
    await expect(page.locator("#inference-panel .network-node")).toHaveCount(3);
    if (operation === "sample") await run(page);
    const download = page.waitForEvent("download");
    await button.click();
    expect((await download).suggestedFilename()).toBe(
      operation === "graph" ? "pdopt-bn-network.svg" : "pdopt-bn-samples.zip",
    );
  });
