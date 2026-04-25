import type { StrategyTable } from "@/lib/generated/strategy";
import { STRATEGY_TABLES } from "@/lib/generated/strategy";

export type VariantId =
  | "standard"
  | "rollover"
  | "deathAttack"
  | "rolloverDeathAttack";

export const VARIANT_ORDER: readonly VariantId[] = [
  "standard",
  "rollover",
  "deathAttack",
  "rolloverDeathAttack",
] as const;

export const VARIANT_LABEL: Record<VariantId, string> = {
  standard: "Standard",
  rollover: "Rollover",
  deathAttack: "Death attack",
  rolloverDeathAttack: "Rollover + death attack",
};

export function strategyTableForVariant(id: VariantId): StrategyTable {
  return STRATEGY_TABLES[id];
}
