// The one soft tile look (rules_global.soft_tiles, 23 Nov 2026): fill #F1F5F9, no border, 20px radius.
// For blocks the owner only reads. Row dividers inside are #E2E8F0 and tags are white. Things the owner
// presses keep a white fill and a border.
export const SOFT_TILE = "rounded-[20px] bg-[#F1F5F9]";
export const SOFT_TILE_DIVIDERS = "[&>div]:border-[#E2E8F0]";
export const SOFT_TILE_CHIP = "bg-[#F1F5F9]";
// The soft hero (rules_global.soft_tiles, Home hero, 24 Nov 2026): Money left today on Home (22) and
// My money (33). Fill #F1F5F9, no border, 24px radius, dark text; label #334155; chips inside are white;
// the eye button is white with a 2px #94A3B8 border.
export const SOFT_HERO = "rounded-[24px] bg-[#F1F5F9] text-[#0F172A]";
export const SOFT_HERO_LABEL = "text-[#334155]";
export const SOFT_HERO_EYE = "border-[#94A3B8] bg-white text-[#0F172A]";
