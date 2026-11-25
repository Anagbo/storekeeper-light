import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

// rules_global.duplicate_person: the inline question under the field that matched (see duplicatePerson.js).
// A name match cannot be saved as a second person with the same name (people are kept by name), so
// "Save as a new person" there asks for a name that tells the two apart; renaming clears it.
export default function DuplicatePersonQuestion({ match, supplier = false, renaming = false, onUse, onNew, buttonRef }) {
  const owed = supplier ? match.person.balancePesewas ?? 0 : match.person.totalDebtPesewas ?? 0;
  const text = t(supplier ? "duplicate.existsSupplier" : "duplicate.exists", { name: displayName(match.person.name), amount: formatGhs(owed) });
  return (
    <div data-duplicate-person={match.by} className="flex flex-col gap-2 pt-1">
      <p role="status" className="text-[17px] font-semibold text-[#0F172A]">{text}</p>
      {renaming ? (
        <p data-duplicate-rename="" className="text-[15px] font-normal text-[#475569]">{t("duplicate.rename")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <PosPrimaryButton type="button" ref={buttonRef} onClick={onUse}>{t("duplicate.use")}</PosPrimaryButton>
          <PosSecondaryButton type="button" onClick={onNew}>{t("duplicate.new")}</PosSecondaryButton>
        </div>
      )}
    </div>
  );
}
