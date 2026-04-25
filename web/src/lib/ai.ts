import type { StrategyRow } from "@/lib/generated/strategy";
import type { Move, Position, Rules } from "@/lib/game";
import {
  applyMove,
  legalMoves,
  moveInList,
  positionIndex,
  unpackMove,
} from "@/lib/game";

export type Difficulty = "easy" | "medium" | "hard" | "master";

export type Outcome = "loss" | "win" | "draw";

export function rowOutcome(r: number): Outcome {
  if (r === 0) {
    return "loss";
  }
  if (r === 1) {
    return "win";
  }
  return "draw";
}

function randomElement<T>(xs: readonly T[]): T {
  if (xs.length === 0) {
    throw new Error("randomElement: empty array");
  }
  return xs[Math.floor(Math.random() * xs.length)]!;
}

function successorRow(
  pos: Position,
  move: Move,
  rules: Rules,
  table: readonly StrategyRow[],
): StrategyRow {
  const next = applyMove(pos, move, rules);
  return table[positionIndex(next, rules)]!;
}

/** Opponent can force a win in `d` plies from the position after our move. */
function opponentWinsWithin(
  pos: Position,
  move: Move,
  rules: Rules,
  table: readonly StrategyRow[],
  maxDepth: number,
): boolean {
  const s = successorRow(pos, move, rules, table);
  return s[0] === 1 && s[1] >= 0 && s[1] <= maxDepth;
}

function instantWinMoves(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move[] {
  return legalMoves(pos, rules).filter((m) => {
    const s = successorRow(pos, m, rules, table);
    return s[0] === 0 && s[1] === 0;
  });
}

function winInThreeMoves(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move[] {
  return legalMoves(pos, rules).filter((m) => {
    const s = successorRow(pos, m, rules, table);
    return s[0] === 0 && s[1] === 2;
  });
}

/**
 * When no move satisfies safety filters: prefer any immediate win, then any
 * draw for the opponent to move, then maximize opponent WIN depth (slowest
 * loss).
 */
function pickSlowestLoss(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move {
  const legal = legalMoves(pos, rules);
  if (legal.length === 0) {
    throw new Error("No legal moves");
  }

  type Tier = 0 | 1 | 2;
  const scored = legal.map((m) => {
    const s = successorRow(pos, m, rules, table);
    if (s[0] === 0) {
      return { m, tier: 0 as Tier, depth: -1 };
    }
    if (s[0] === 2) {
      return { m, tier: 1 as Tier, depth: -1 };
    }
    return { m, tier: 2 as Tier, depth: s[1] };
  });

  const bestTier = Math.min(...scored.map((x) => x.tier));
  const tiered = scored.filter((x) => x.tier === bestTier);
  if (bestTier < 2) {
    return randomElement(tiered).m;
  }
  const maxD = Math.max(...tiered.map((x) => x.depth));
  return randomElement(tiered.filter((x) => x.depth === maxD)).m;
}

function mediumMove(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move {
  const legal = legalMoves(pos, rules);
  if (legal.length === 0) {
    throw new Error("No legal moves");
  }

  const wins = instantWinMoves(pos, rules, table);
  if (wins.length > 0) {
    return randomElement(wins);
  }

  const safe = legal.filter((m) => !opponentWinsWithin(pos, m, rules, table, 1));
  if (safe.length > 0) {
    return randomElement(safe);
  }
  return pickSlowestLoss(pos, rules, table);
}

function hardMove(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move {
  const legal = legalMoves(pos, rules);
  if (legal.length === 0) {
    throw new Error("No legal moves");
  }

  const wins = instantWinMoves(pos, rules, table);
  if (wins.length > 0) {
    return randomElement(wins);
  }

  const w3 = winInThreeMoves(pos, rules, table);
  if (w3.length > 0) {
    return randomElement(w3);
  }

  const safe = legal.filter((m) => !opponentWinsWithin(pos, m, rules, table, 3));
  if (safe.length > 0) {
    return randomElement(safe);
  }
  return pickSlowestLoss(pos, rules, table);
}

function masterDrawingMoves(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move[] {
  return legalMoves(pos, rules).filter((m) => successorRow(pos, m, rules, table)[0] === 2);
}

function masterMove(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move {
  const legal = legalMoves(pos, rules);
  if (legal.length === 0) {
    throw new Error("No legal moves");
  }

  const idx = positionIndex(pos, rules);
  const row = table[idx]!;
  const [, , packed] = row;

  if (row[0] === 2) {
    const drawMoves = masterDrawingMoves(pos, rules, table);
    if (drawMoves.length > 0) {
      return randomElement(drawMoves);
    }
  }

  const fromTable = packed
    .map(unpackMove)
    .filter((m) => moveInList(m, legal));
  if (fromTable.length > 0) {
    return randomElement(fromTable);
  }

  if (row[0] === 2) {
    return randomElement(legal);
  }

  return randomElement(legal);
}

export function chooseAiMove(
  difficulty: Difficulty,
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move {
  const legal = legalMoves(pos, rules);
  if (legal.length === 0) {
    throw new Error("No legal moves");
  }
  if (difficulty === "easy") {
    return randomElement(legal);
  }
  if (difficulty === "medium") {
    return mediumMove(pos, rules, table);
  }
  if (difficulty === "hard") {
    return hardMove(pos, rules, table);
  }
  return masterMove(pos, rules, table);
}

export function hintMoves(
  pos: Position,
  rules: Rules,
  table: readonly StrategyRow[],
): Move[] {
  const row = table[positionIndex(pos, rules)]!;
  const legal = legalMoves(pos, rules);
  if (row[0] === 2) {
    const drawMoves = masterDrawingMoves(pos, rules, table);
    if (drawMoves.length > 0) {
      return drawMoves;
    }
  }
  return row[2].map(unpackMove).filter((m) => moveInList(m, legal));
}

export function formatMove(move: Move): string {
  if (move.kind === "attack") {
    return `Attack ${move.myHand === 0 ? "left" : "right"} → their ${
      move.theirHand === 0 ? "left" : "right"
    }`;
  }
  return `Split → ${move.lo}-${move.hi}`;
}

export function moveKey(move: Move): string {
  if (move.kind === "attack") {
    return `a:${move.myHand}:${move.theirHand}`;
  }
  return `s:${move.lo}:${move.hi}`;
}
