// rules_global.customer_proof (decided 16 Nov 2026): the customer's finger signature on ONE credit
// event, stored on its transactions row as four fields. Points are whole numbers 0..1000 (the box is
// scaled to 1000 x 1000), at most 1,500 points, under 20 KB as JSON. Written once, never replaced.
// Local only: stripped from every sync payload, and signing never marks the event pending.
export const SIGNATURE_FIELDS = Object.freeze(["signature", "signedAt", "signedAmountPesewas", "signedReason"]);
export const SIGNATURE_SCALE = 1000;
export const SIGNATURE_MAX_POINTS = 1500;
export const SIGNATURE_MAX_BYTES = 20_000;
const SIGNED_REASON_MAX_LENGTH = 5000;

const isCoordinate = (value) => Number.isSafeInteger(value) && value >= 0 && value <= SIGNATURE_SCALE;
const isPoint = (point) => Array.isArray(point) && point.length === 2 && isCoordinate(point[0]) && isCoordinate(point[1]);

export function countSignaturePoints(strokes) {
  return Array.isArray(strokes) ? strokes.reduce((sum, stroke) => sum + (Array.isArray(stroke) ? stroke.length : 0), 0) : 0;
}

// The stored shape: a non-empty list of strokes, each a non-empty list of [x, y] points.
export function isValidSignature(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return false;
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0 || !stroke.every(isPoint)) return false;
    points += stroke.length;
    if (points > SIGNATURE_MAX_POINTS) return false;
  }
  return JSON.stringify(strokes).length <= SIGNATURE_MAX_BYTES;
}

const clampCoordinate = (value) => Math.min(SIGNATURE_SCALE, Math.max(0, Math.round(value)));

// What Done saves: coordinates rounded into 0..1000, empty strokes dropped, and the strokes thinned
// (every n-th point, always the last point of a stroke) until they fit the point and size limits.
export function thinSignature(strokes) {
  const clean = (Array.isArray(strokes) ? strokes : [])
    .map((stroke) => (Array.isArray(stroke) ? stroke : [])
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map(([x, y]) => [clampCoordinate(x), clampCoordinate(y)]))
    .filter((stroke) => stroke.length > 0)
    .slice(0, SIGNATURE_MAX_POINTS);
  if (!clean.length) return [];
  for (let step = 1; ; step += 1) {
    const thinned = step === 1 ? clean : clean.map((stroke) => stroke.filter((_, index) => index % step === 0 || index === stroke.length - 1));
    if (isValidSignature(thinned)) return thinned;
    // Every stroke is down to its first and last point: keep the longest strokes that fit.
    if (thinned.every((stroke) => stroke.length <= 2)) {
      const kept = [...thinned];
      while (kept.length && !isValidSignature(kept)) kept.pop();
      return kept;
    }
  }
}

// The four fields of a signed event, all present and well formed.
export function isValidSignatureRecord(record) {
  return isValidSignature(record?.signature) &&
    Number.isSafeInteger(record.signedAt) && record.signedAt > 0 &&
    Number.isSafeInteger(record.signedAmountPesewas) && record.signedAmountPesewas >= 0 &&
    typeof record.signedReason === "string" && record.signedReason.length <= SIGNED_REASON_MAX_LENGTH;
}

export function hasSignatureFields(record) {
  return SIGNATURE_FIELDS.some((field) => record?.[field] !== undefined);
}

// Old events have none of the fields and read as Not signed; so does anything malformed.
export function isSignedEvent(record) {
  return isValidSignatureRecord(record);
}

export function withoutSignatureFields(record) {
  if (!hasSignatureFields(record)) return record;
  const copy = { ...record };
  for (const field of SIGNATURE_FIELDS) delete copy[field];
  return copy;
}

export function pickSignatureFields(record) {
  return Object.fromEntries(SIGNATURE_FIELDS.map((field) => [field, record[field]]));
}
