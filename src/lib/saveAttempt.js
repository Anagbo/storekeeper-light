// D11 save attempts, shared by screens and writers (no database import here).

// A stable text form of what is being saved: object keys sorted, undefined and functions
// left out, array order kept. Two saves with the same fingerprint record the same thing.
export function fingerprintSave(content) {
  return JSON.stringify(normalize(content));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined || typeof item === "function" ? null : normalize(item)));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "function") continue;
      out[key] = normalize(item);
    }
    return out;
  }
  return value;
}

// By name, so it also works across separately bundled copies of the error class.
export function isSaveOutcomeUnknown(error) {
  return error?.name === "SaveOutcomeUnknownError";
}

export function isSaveTimeout(error) {
  return error?.name === "SaveTimeoutError";
}