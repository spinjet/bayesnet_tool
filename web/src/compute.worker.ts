import ELK from "elkjs/lib/elk-api.js";
import { z } from "zod";
import { datasetSchema, validateProject, inferenceReady } from "./domain";
import { parseCsv, configureVariable, prepareRows, train } from "./processing";
import { infer, ModelError } from "./engine";
const requestSchema = z.object({
  id: z.number().int(),
  op: z.enum(["import", "configure", "preview", "train", "infer", "layout"]),
  payload: z.unknown(),
});
self.onmessage = async ({ data }) => {
  let id = -1;
  try {
    const request = requestSchema.parse(data);
    id = request.id;
    const raw = request.payload;
    let result: unknown;
    if (request.op === "import") {
      const p = z
        .object({
          csv: z.string(),
          name: z.string(),
          delimiter: z.string().max(1),
          tokens: z.array(z.string()),
        })
        .parse(raw);
      result = await parseCsv(p.csv, p.name, p.delimiter, p.tokens);
    } else {
      const p = z
        .object({
          project: z.unknown(),
          dataset: datasetSchema.optional(),
          options: z.unknown().optional(),
          engineUrl: z.url().optional(),
          layoutUrl: z.url().optional(),
        })
        .parse(raw);
      const project = validateProject(p.project);
      if (request.op === "layout") {
        const layoutUrl = new URL(p.layoutUrl!);
        if (layoutUrl.origin !== self.location.origin)
          throw new Error("Layout must load locally.");
        const elk = new ELK({ workerUrl: layoutUrl.href });
        try {
          const g = await elk.layout({
            id: "root",
            layoutOptions: {
              "elk.algorithm": "layered",
              "elk.direction": "RIGHT",
              "elk.spacing.nodeNode": "65",
            },
            children: project.variables.map((v) => ({
              id: v.id,
              width: 180,
              height: 80,
            })),
            edges: project.edges.map((e) => ({
              id: e.id,
              sources: [e.source],
              targets: [e.target],
            })),
          });
          result = g.children?.map((n) => ({
            id: n.id,
            x: n.x || 0,
            y: n.y || 0,
          }));
        } finally {
          elk.terminateWorker();
        }
      } else if (request.op === "infer") {
        inferenceReady(project);

        const url = new URL(p.engineUrl!);
        if (url.origin !== self.location.origin)
          throw new Error("Engine must load from the same origin.");
        let createInProcessBN: typeof import("jsagrum").createInProcessBN;
        try {
          ({ createInProcessBN } = await import(/* @vite-ignore */ url.href));
        } catch {
          throw new ModelError(
            "ENGINE_INIT_FAILED",
            "Could not load the local inference engine. Check the static assets and retry.",
          );
        }
        result = await infer(
          { variables: project.variables, cpts: project.cpts },
          project.evidence,
          project.variables.map((v) => v.id),
          async () => {
            try {
              return await createInProcessBN();
            } catch {
              throw new ModelError(
                "ENGINE_INIT_FAILED",
                "Could not initialize WASM. Check the static assets and retry.",
              );
            }
          },
          project.queryGroups,
        );
      } else {
        if (!p.dataset || p.dataset.hash !== project.dataset?.hash)
          throw new Error(
            "Reattach the matching source dataset before training.",
          );
        if (request.op === "configure") {
          const o = z
            .object({
              columnId: z.string(),
              representation: z.enum([
                "categorical",
                "finiteNumeric",
                "discretised",
              ]),
              method: z.enum(["manual", "equalWidth", "quantile"]),
              bins: z.number().int(),
              manual: z.array(z.number().finite()),
            })
            .parse(p.options);
          result = configureVariable(
            p.dataset,
            project,
            o.columnId,
            o.representation,
            o.method,
            o.bins,
            o.manual,
          );
        } else if (request.op === "preview") {
          const prepared = prepareRows(p.dataset, project);
          result = {
            retained: prepared.retained,
            dropped: prepared.dropped,
            counts: project.variables.map((v, i) =>
              v.states.map((_, k) =>
                prepared.encoded.reduce(
                  (n, row) => n + Number(row[i] === k),
                  0,
                ),
              ),
            ),
          };
        } else {
          const o = z
            .object({ method: z.enum(["mle", "dirichlet"]), alpha: z.number() })
            .parse(p.options);
          result = train(p.dataset, project, o.method, o.alpha);
        }
      }
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({
      id,
      error: e instanceof Error ? e.message : String(e),
      code: (e as { code?: string }).code || "OPERATION_FAILED",
    });
  }
};
