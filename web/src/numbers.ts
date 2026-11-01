/** Adjacent representable doubles, used for exact open/closed numeric cuts. */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  b.setBigUint64(0, b.getBigUint64(0) + (x > 0 ? 1n : -1n));
  return b.getFloat64(0);
}
export function nextDown(x: number): number {
  return -nextUp(-x);
}
