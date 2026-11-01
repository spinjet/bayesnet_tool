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
  if (/^(\s*[=+\-@]|[\t\r])/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
