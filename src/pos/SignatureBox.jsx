import { useEffect, useRef } from "react";
import { countSignaturePoints, SIGNATURE_SCALE } from "../lib/signature.js";
import { posText as t } from "./i18n.js";

// Wiring 72 "Signature box": a dashed 190px box; "Sign here with your finger" disappears on the first
// stroke. Finger, pen or mouse draws; touch-action none on the box and the canvas, so the page never
// scrolls or zooms while drawing. Points are kept scaled to 0..1000 on both axes (lib/signature.js).
// While drawing, at most DRAWING_POINT_LIMIT points are kept; Done thins them to the stored limit.
// `strokes` is the drawing so far; `onChange` gets the new list after each stroke starts, moves or ends.
export const DRAWING_POINT_LIMIT = 6000;

export function toSignaturePoint(event, rect) {
  const width = rect.width || 1;
  const height = rect.height || 1;
  const x = ((event.clientX - rect.left) / width) * SIGNATURE_SCALE;
  const y = ((event.clientY - rect.top) / height) * SIGNATURE_SCALE;
  const clamp = (value) => Math.min(SIGNATURE_SCALE, Math.max(0, Math.round(value)));
  return [clamp(x), clamp(y)];
}

function draw(canvas, strokes) {
  const context = canvas?.getContext?.("2d");
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  context.lineWidth = 3 * ratio;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#0F172A";
  const sx = width / SIGNATURE_SCALE;
  const sy = height / SIGNATURE_SCALE;
  for (const stroke of strokes) {
    context.beginPath();
    stroke.forEach(([x, y], index) => (index === 0 ? context.moveTo(x * sx, y * sy) : context.lineTo(x * sx, y * sy)));
    if (stroke.length === 1) context.lineTo(stroke[0][0] * sx + 0.5, stroke[0][1] * sy + 0.5);
    context.stroke();
  }
}

export default function SignatureBox({ strokes, onChange, disabled = false }) {
  const canvasRef = useRef(null);
  const drawing = useRef(null);
  const latest = useRef(strokes);
  latest.current = strokes;

  useEffect(() => {
    draw(canvasRef.current, strokes);
  }, [strokes]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const redraw = () => draw(canvasRef.current, latest.current);
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, []);

  function start(event) {
    if (disabled || countSignaturePoints(latest.current) >= DRAWING_POINT_LIMIT) return;
    event.preventDefault?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    drawing.current = { pointerId: event.pointerId, rect };
    onChange([...latest.current, [toSignaturePoint(event, rect)]]);
  }

  function move(event) {
    const active = drawing.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault?.();
    const point = toSignaturePoint(event, active.rect);
    const strokesNow = latest.current;
    const last = strokesNow.at(-1) ?? [];
    const previous = last.at(-1);
    if (previous && previous[0] === point[0] && previous[1] === point[1]) return;
    if (countSignaturePoints(strokesNow) >= DRAWING_POINT_LIMIT) return;
    onChange([...strokesNow.slice(0, -1), [...last, point]]);
  }

  function end(event) {
    if (drawing.current?.pointerId === event.pointerId) drawing.current = null;
  }

  const empty = !strokes.some((stroke) => stroke.length > 0);
  return (
    <div data-signature-box="" className="relative h-[190px] w-full rounded-[18px] border-[3px] border-dashed border-slate-500 bg-white" style={{ touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        aria-label={t("signature.box")}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute inset-0 h-full w-full rounded-2xl"
        style={{ touchAction: "none" }}
      />
      {empty && (
        <span data-signature-placeholder="" className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-xl font-bold text-slate-500">
          {t("signature.signHere")}
        </span>
      )}
    </div>
  );
}
