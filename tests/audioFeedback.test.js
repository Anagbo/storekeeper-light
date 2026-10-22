import test from "node:test";
import assert from "node:assert/strict";
import {
  isAudioFeedbackEnabled,
  playErrorChime,
  playExpenseChime,
  playSuccessChime,
  setAudioFeedbackEnabled,
  speakConfirmation
} from "../src/utils/audioFeedback.js";

test("audio feedback defaults to enabled and can be muted for the session", () => {
  setAudioFeedbackEnabled(true);
  assert.equal(isAudioFeedbackEnabled(), true);
  setAudioFeedbackEnabled(false);
  assert.equal(isAudioFeedbackEnabled(), false);
  setAudioFeedbackEnabled(true);
});

test("feedback helpers safely no-op where browser audio APIs are unavailable", () => {
  assert.doesNotThrow(() => playSuccessChime());
  assert.doesNotThrow(() => playExpenseChime());
  assert.doesNotThrow(() => playErrorChime());
  assert.doesNotThrow(() => speakConfirmation("Sale saved"));
});
