import { createContext, useContext } from "react";

// Wide Settings (D13, wide_layout.screens["47 Settings"]): 63, 64 and 71 are drawn in the right pane of
// Settings instead of a screen of their own. Settings says which mode the pane is in (the layout mode);
// null everywhere else, so the phone screens and their task columns stay as they are.
export const SettingsPaneContext = createContext(null);
export function useSettingsPane() {
  return useContext(SettingsPaneContext);
}

// Wide type (text 17px+, helper and tags 15px+): the phone components keep their classes; inside the pane
// their small text is drawn at 17px.
export const WIDE_PANE_TEXT = "[&_.text-xs]:text-[15px] [&_.text-sm]:text-[17px] [&_.text-base]:text-[17px]";

// Buttons in the pane are not stretched to its width (design_principles: 160 to 240px).
export const PANE_BUTTON = "w-full max-w-[240px]";

// The pane: the section title, the section's content (scrolls by itself), and an optional footer pinned at
// the bottom of the pane (63's Save). The pane is as tall as its content, at most the column.
export function SettingsPane({ id, title, footer, children }) {
  const mode = useSettingsPane();
  const side = mode === "rail" ? "px-5" : "px-6";
  return (
    <section data-settings-pane={id} aria-labelledby={`settings-pane-${id}`} className="flex max-h-full min-h-0 min-w-0 flex-col rounded-[20px] border-2 border-slate-300 bg-white">
      <div data-settings-pane-body="" className={`flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto ${side} py-5 ${WIDE_PANE_TEXT}`}>
        <h2 id={`settings-pane-${id}`} className="text-[24px] font-bold leading-tight text-[#0F172A]">{title}</h2>
        {children}
      </div>
      {footer && <div data-settings-pane-footer="" className={`flex shrink-0 flex-col items-end gap-2 border-t-2 border-slate-200 ${side} py-4 ${WIDE_PANE_TEXT}`}>{footer}</div>}
    </section>
  );
}
