export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  let s = String(value);
  if (typeof value !== "number" && /^(\s*[=+\-@]|[\t\r])/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

export function downloadBytes(name: string, bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const view = root.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  if (!view || view.length !== 4 || view.some((x) => !Number.isFinite(x)))
    throw new Error("Invalid SVG image dimensions.");
  const scale = 2,
    width = Math.ceil(view[2] * scale),
    height = Math.ceil(view[3] * scale);
  if (
    width < 1 ||
    height < 1 ||
    width * height > 20_000_000 ||
    width > 16000 ||
    height > 16000
  )
    throw new Error("PNG is too large. Export SVG or omit probabilities.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Could not rasterise the network image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable. Export SVG.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG generation failed."))),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
