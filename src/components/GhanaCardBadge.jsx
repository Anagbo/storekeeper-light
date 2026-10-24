import { useEffect, useRef, useState } from "react";
import { Check, IdCard } from "lucide-react";

export default function GhanaCardBadge({ number, customerName = "customer" }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timeout = useRef(null);

  useEffect(() => () => window.clearTimeout(timeout.current), []);

  async function copyNumber() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setError("");
      window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      console.error("Could not copy the Ghana Card number.", copyError);
      setCopied(false);
      setError("Could not copy ID.");
    }
  }

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copyNumber()}
        aria-label={copied ? `Ghana Card number copied for ${customerName}` : `Copy Ghana Card number for ${customerName}`}
        title={copied ? "Copied" : "Copy Ghana Card number"}
        className="inline-flex min-h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-full bg-slate-100 px-3 text-sm text-slate-800 transition hover:bg-slate-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-600"
      >
        {copied
          ? <Check size={16} className="shrink-0 text-emerald-700" aria-hidden="true" />
          : <IdCard size={16} className="shrink-0" aria-hidden="true" />}
        <span className="truncate">{number}</span>
        <span aria-live="polite" className="sr-only">{copied ? "Copied" : ""}</span>
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
