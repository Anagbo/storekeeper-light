const PAYMENT_METHODS = [
  {
    value: "cash",
    label: "💵 Cash",
    selected: "bg-emerald-600 text-white"
  },
  {
    value: "momo",
    label: "📱 MoMo",
    selected: "bg-amber-500 font-semibold text-slate-900"
  }
];

export default function PaymentMethodToggle({ value = "cash", onChange, label = "Payment method", methods = PAYMENT_METHODS }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className={`grid gap-2 ${methods.length === 3 ? "grid-cols-1 min-[360px]:grid-cols-3" : "grid-cols-2"}`} role="group">
        {methods.map((method) => (
          <button
            key={method.value}
            type="button"
            aria-pressed={value === method.value}
            onClick={() => onChange(method.value)}
            className={`min-h-[48px] rounded-full px-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-leaf focus:ring-offset-2 ${
              value === method.value
                ? method.selected
                : "bg-slate-100 font-medium text-slate-700 hover:bg-slate-200"
            }`}
          >
            {method.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
