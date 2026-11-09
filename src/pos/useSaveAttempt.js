import { useRef, useState } from "react";
import { createId } from "../lib/ids.js";
import { fingerprintSave, isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { SAVE_TIMEOUT_MS } from "../db/runTransactionWithTimeout.js";

// D11: one save attempt key per screen, tied to what is being saved (owner condition).
// - The same content keeps the key until the outcome is known, so Try again after an
//   unknown result cannot record twice (the writer returns the first save).
// - Different content (cart, amounts, method) gets a new key.
// - Known outcome (saved, or certainly not saved): the key is dropped.
// Known gap (owner, accepted): leaving the screen loses the key.
export function useSaveAttempt() {
  const attemptRef = useRef(null);
  const [status, setStatus] = useState("idle");

  async function run(content, save) {
    const fingerprint = fingerprintSave(content);
    if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
      attemptRef.current = { id: createId(), fingerprint };
    }
    const attemptId = attemptRef.current.id;
    setStatus("saving");
    const checkingTimer = setTimeout(() => setStatus("checking"), SAVE_TIMEOUT_MS);
    try {
      const result = await save(attemptId);
      attemptRef.current = null;
      setStatus("idle");
      return result;
    } catch (error) {
      if (isSaveOutcomeUnknown(error)) {
        setStatus("unknown");
      } else {
        attemptRef.current = null;
        setStatus("idle");
      }
      throw error;
    } finally {
      clearTimeout(checkingTimer);
    }
  }

  return {
    run,
    checking: status === "checking",
    unknown: status === "unknown"
  };
}
