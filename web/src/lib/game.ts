/** Game rules and move generation — mirrors `chopsticks.cpp` / `chopsticks.hpp`. */

export type Rules = {
  readonly maxFingers: number;
  readonly rollover: boolean;
  readonly deathAttack: boolean;
};

export const RULES_BY_VARIANT = {
  standard: { maxFingers: 5, rollover: false, deathAttack: false },
  rollover: { maxFingers: 5, rollover: true, deathAttack: false },
  deathAttack: { maxFingers: 5, rollover: false, deathAttack: true },
  rolloverDeathAttack: { maxFingers: 5, rollover: true, deathAttack: true },
} as const;

export type Hands = readonly [lo: number, hi: number];

export type Position = {
  readonly current: Hands;
  readonly opponent: Hands;
};

export type Move =
  | { readonly kind: "attack"; readonly myHand: 0 | 1; readonly theirHand: 0 | 1 }
  | { readonly kind: "split"; readonly lo: number; readonly hi: number };

export function normalizeHands(a: number, b: number): Hands {
  return a <= b ? [a, b] : [b, a];
}

/** Left/right as shown in the UI; engine always uses {@link normalizeHands}. */
export type DisplayHands = readonly [left: number, right: number];

export function engineHands(display: DisplayHands): Hands {
  return normalizeHands(display[0], display[1]);
}

/**
 * Map a screen hand index (0 = left, 1 = right) to engine hand index (0 = lo, 1 = hi).
 * When both counts match, left ↔ engine 0 and right ↔ engine 1 so the clicked side is unambiguous.
 */
export function displayToEngineHand(
  display: DisplayHands,
  displayIdx: 0 | 1,
): 0 | 1 {
  if (display[0] === display[1]) {
    return displayIdx;
  }
  const v = display[displayIdx];
  const lo = Math.min(display[0], display[1]);
  return (v === lo ? 0 : 1) as 0 | 1;
}

/** Engine hand index → which screen side shows that finger count (for this display). */
export function engineToDisplayHandIndex(
  display: DisplayHands,
  engineIdx: 0 | 1,
): 0 | 1 {
  if (display[0] === display[1]) {
    return engineIdx;
  }
  const ordered = display[0] <= display[1];
  if (engineIdx === 0) {
    return (ordered ? 0 : 1) as 0 | 1;
  }
  return (ordered ? 1 : 0) as 0 | 1;
}

/** Keep left/right stable when the multiset updates (e.g. after an attack). */
export function alignDisplayToNorm(
  prev: DisplayHands,
  norm: Hands,
): DisplayHands {
  const [a, b] = norm;
  if (a === b) {
    return [a, b];
  }
  const orderA: DisplayHands = [a, b];
  const orderB: DisplayHands = [b, a];
  const da =
    (prev[0] !== orderA[0] ? 1 : 0) + (prev[1] !== orderA[1] ? 1 : 0);
  const db =
    (prev[0] !== orderB[0] ? 1 : 0) + (prev[1] !== orderB[1] ? 1 : 0);
  return da <= db ? orderA : orderB;
}

export function handsEqual(a: Hands, b: Hands): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Finger sum on a defending hand after being tapped (engine rules). */
export function attackResult(
  rules: Rules,
  target: number,
  attacker: number,
): number {
  const sum = target + attacker;
  if (sum >= rules.maxFingers) {
    return rules.rollover ? sum % rules.maxFingers : 0;
  }
  return sum;
}

export function handsIndex(hands: Hands, rules: Rules): number {
  let idx = 0;
  for (let a = 0; a < rules.maxFingers; a++) {
    for (let b = a; b < rules.maxFingers; b++) {
      if (a === hands[0] && b === hands[1]) {
        return idx;
      }
      idx++;
    }
  }
  return -1;
}

export function handsCount(rules: Rules): number {
  const n = rules.maxFingers;
  return (n * (n + 1)) / 2;
}

export function handsFromIndex(idx: number, rules: Rules): Hands {
  let i = 0;
  for (let a = 0; a < rules.maxFingers; a++) {
    for (let b = a; b < rules.maxFingers; b++) {
      if (i === idx) {
        return [a, b];
      }
      i++;
    }
  }
  return [0, 0];
}

export function positionIndex(pos: Position, rules: Rules): number {
  const h = handsCount(rules);
  return handsIndex(pos.current, rules) * h + handsIndex(pos.opponent, rules);
}

export function positionFromIndex(idx: number, rules: Rules): Position {
  const h = handsCount(rules);
  const ci = Math.floor(idx / h);
  const oi = idx % h;
  return { current: handsFromIndex(ci, rules), opponent: handsFromIndex(oi, rules) };
}

export function positionCount(rules: Rules): number {
  const h = handsCount(rules);
  return h * h;
}

export function isDead(h: Hands): boolean {
  return h[0] === 0 && h[1] === 0;
}

export function isTerminal(pos: Position): boolean {
  return isDead(pos.current);
}

export function initialPosition(): Position {
  return { current: [1, 1], opponent: [1, 1] };
}

export function legalMoves(pos: Position, rules: Rules): Move[] {
  const moves: Move[] = [];
  if (isTerminal(pos)) {
    return moves;
  }

  const attackSeen = new Set<string>();
  for (let myHand = 0 as 0 | 1; myHand < 2; myHand++) {
    const myVal = pos.current[myHand];
    if (myVal === 0) {
      continue;
    }
    for (let theirHand = 0 as 0 | 1; theirHand < 2; theirHand++) {
      const theirVal = pos.opponent[theirHand];
      if (!rules.deathAttack && theirVal === 0) {
        continue;
      }
      const newVal = attackResult(rules, theirVal, myVal);
      const key = `${myVal},${newVal}`;
      if (attackSeen.has(key)) {
        continue;
      }
      attackSeen.add(key);
      moves.push({ kind: "attack", myHand, theirHand });
    }
  }

  const total = pos.current[0] + pos.current[1];
  if (total > 0) {
    const splitSeen = new Set<string>();
    splitSeen.add(`${pos.current[0]},${pos.current[1]}`);
    for (let newLo = 0; newLo < rules.maxFingers; newLo++) {
      const newHi = total - newLo;
      if (newHi < newLo) {
        continue;
      }
      if (newHi >= rules.maxFingers) {
        continue;
      }
      if (newLo === 0 && newHi === 0) {
        continue;
      }
      const cfg = `${newLo},${newHi}`;
      if (splitSeen.has(cfg)) {
        continue;
      }
      splitSeen.add(cfg);
      moves.push({ kind: "split", lo: newLo, hi: newHi });
    }
  }

  return moves;
}

export function applyMove(pos: Position, move: Move, rules: Rules): Position {
  let newCurrent = pos.current;
  let newOpp = pos.opponent;

  if (move.kind === "attack") {
    const myVal = pos.current[move.myHand];
    const theirVal = pos.opponent[move.theirHand];
    const v = attackResult(rules, theirVal, myVal);
    const oppFingers: [number, number] = [pos.opponent[0], pos.opponent[1]];
    oppFingers[move.theirHand] = v;
    newOpp = normalizeHands(oppFingers[0], oppFingers[1]);
  } else {
    newCurrent = normalizeHands(move.lo, move.hi);
  }

  return { current: newOpp, opponent: newCurrent };
}

/** Packed move codes — must match `export_strategy.cpp`. */
export function packMove(move: Move): number {
  if (move.kind === "attack") {
    return 10 + move.myHand * 2 + move.theirHand;
  }
  return 100 + move.lo * 8 + move.hi;
}

export function unpackMove(code: number): Move {
  if (code >= 100) {
    const rest = code - 100;
    const lo = Math.floor(rest / 8);
    const hi = rest % 8;
    return { kind: "split", lo, hi };
  }
  const x = code - 10;
  const myHand = (x >> 1) as 0 | 1;
  const theirHand = (x & 1) as 0 | 1;
  return { kind: "attack", myHand, theirHand };
}

export function movesEqual(a: Move, b: Move): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "attack" && b.kind === "attack") {
    return a.myHand === b.myHand && a.theirHand === b.theirHand;
  }
  if (a.kind === "split" && b.kind === "split") {
    return a.lo === b.lo && a.hi === b.hi;
  }
  return false;
}

export function moveInList(move: Move, list: readonly Move[]): boolean {
  return list.some((m) => movesEqual(m, move));
}

/**
 * `legalMoves` deduplicates attacks by (attacker value, new defender value), so when
 * both opponent engine hands have the same count only one mirror (theirHand 0 vs 1)
 * may appear. Map the intended target to an equivalent legal attack.
 */
export function resolveAttackInLegalList(
  legal: readonly Move[],
  myHand: 0 | 1,
  theirHand: 0 | 1,
  opponent: Hands,
): Move | null {
  const direct: Move = { kind: "attack", myHand, theirHand };
  if (moveInList(direct, legal)) {
    return direct;
  }
  if (opponent[0] === opponent[1]) {
    const altHand = (1 - theirHand) as 0 | 1;
    const alt: Move = { kind: "attack", myHand, theirHand: altHand };
    if (moveInList(alt, legal)) {
      return alt;
    }
  }
  return null;
}

/** Selected-hand attack from display indices; tries alternate engine myHand when both your counts match. */
export function resolveHumanAttackOnOpponentDisplay(
  legal: readonly Move[],
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
  myDisplayIdx: 0 | 1,
  oppDisplayIdx: 0 | 1,
): Move | null {
  const opp = engineHands(aiDisplay);
  const hn = engineHands(humanDisplay);
  const myE = displayToEngineHand(humanDisplay, myDisplayIdx);
  const thE = displayToEngineHand(aiDisplay, oppDisplayIdx);
  const tryMy = (m: 0 | 1) =>
    hn[m] === 0 ? null : resolveAttackInLegalList(legal, m, thE, opp);
  let m = tryMy(myE);
  if (m) {
    return m;
  }
  if (humanDisplay[0] === humanDisplay[1] && humanDisplay[0] > 0) {
    m = tryMy((1 - myE) as 0 | 1);
  }
  return m;
}

/** Build turn-relative position for the player to move. */
export function toTurnPosition(
  bottom: Hands,
  top: Hands,
  bottomToMove: boolean,
): Position {
  return bottomToMove
    ? { current: bottom, opponent: top }
    : { current: top, opponent: bottom };
}
