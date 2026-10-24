// Unit handling. All internal geometry is in metres.
export const UNIT_TO_M = Object.freeze({ m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 });

export function unitFactor(units = 'm') {
  const f = Object.prototype.hasOwnProperty.call(UNIT_TO_M, units) ? UNIT_TO_M[units] : undefined; // "constructor" is not a unit
  if (f === undefined) throw new RangeError(`unknown units "${units}" (use m, cm, mm, ft or in)`);
  return f;
}
