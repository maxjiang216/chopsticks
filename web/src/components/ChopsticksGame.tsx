"use client";

import {
  chooseAiMove,
  hintMoves,
  moveKey,
  rowOutcome,
  type Difficulty,
} from "@/lib/ai";
import {
  alignDisplayToNorm,
  applyMove,
  attackResult,
  displayToEngineHand,
  engineHands,
  engineToDisplayHandIndex,
  initialPosition,
  isDead,
  legalMoves,
  moveInList,
  movesEqual,
  resolveAttackInLegalList,
  resolveHumanAttackOnOpponentDisplay,
  type Move,
  type Position,
  packMove,
  positionIndex,
  type Rules,
  RULES_BY_VARIANT,
  type DisplayHands,
} from "@/lib/game";
import { STRATEGY_TABLES } from "@/lib/generated/strategy";
import { type VariantId, VARIANT_LABEL, VARIANT_ORDER } from "@/lib/variants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GameResult = "human" | "ai" | null;

type AnimState =
  | null
  | {
      readonly kind: "attack";
      readonly actor: "human" | "ai";
      readonly myHand: 0 | 1;
      readonly theirHand: 0 | 1;
      /** Human attack: which screen side was tapped / selected (engine alias). */
      readonly myDisplayIdx?: 0 | 1;
      readonly theirDisplayIdx?: 0 | 1;
    }
  | { readonly kind: "split"; readonly actor: "human" | "ai" };

function toPosition(
  human: DisplayHands,
  ai: DisplayHands,
  humanToMove: boolean,
): Position {
  const hn = engineHands(human);
  const an = engineHands(ai);
  return humanToMove
    ? { current: hn, opponent: an }
    : { current: an, opponent: hn };
}

function displayBumpsForRow(
  anim: AnimState,
  row: "human" | "ai",
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
): readonly [
  "attacker" | "target" | null,
  "attacker" | "target" | null,
] {
  let left: "attacker" | "target" | null = null;
  let right: "attacker" | "target" | null = null;
  if (!anim || anim.kind !== "attack") {
    return [left, right];
  }
  if (anim.actor === "human") {
    if (row === "human") {
      const i =
        anim.myDisplayIdx !== undefined
          ? anim.myDisplayIdx
          : engineToDisplayHandIndex(humanDisplay, anim.myHand);
      if (i === 0) {
        left = "attacker";
      } else {
        right = "attacker";
      }
    } else {
      const i =
        anim.theirDisplayIdx !== undefined
          ? anim.theirDisplayIdx
          : engineToDisplayHandIndex(aiDisplay, anim.theirHand);
      if (i === 0) {
        left = "target";
      } else {
        right = "target";
      }
    }
  } else {
    if (row === "ai") {
      const i = engineToDisplayHandIndex(aiDisplay, anim.myHand);
      if (i === 0) {
        left = "attacker";
      } else {
        right = "attacker";
      }
    } else {
      const i = engineToDisplayHandIndex(humanDisplay, anim.theirHand);
      if (i === 0) {
        left = "target";
      } else {
        right = "target";
      }
    }
  }
  return [left, right];
}

/**
 * Hand art by finger count. There is no standard “exactly four fingers” emoji;
 * ✋ is used as a stand-in. For three, 👌 (OK) per request.
 * Zero uses ✊ (fist) — reads as “no fingers out”; swap if you meant a different “first”.
 */
function handEmojiForFingerCount(count: number): string {
  const n = Math.max(0, Math.floor(count));
  switch (n) {
    case 0:
      return "✊";
    case 1:
      return "☝️";
    case 2:
      return "✌️";
    case 3:
      return "👌";
    case 4:
      return "✋";
    case 5:
      return "🤚";
    default:
      return "🤚";
  }
}

function HandCard({
  label,
  value,
  accent,
  bump,
  selected,
  hinted,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly value: number;
  readonly accent: "sky" | "pink";
  readonly bump: "attacker" | "target" | null;
  readonly selected: boolean;
  readonly hinted: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const ring =
    accent === "sky"
      ? "border-sky-400/50 shadow-sky-500/20"
      : "border-pink-400/50 shadow-pink-500/20";
  const anim =
    bump === "attacker"
      ? "animate-bump-attacker"
      : bump === "target"
        ? "animate-bump-target"
        : "";
  const sel = selected
    ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900"
    : "";
  const hint = hinted
    ? "border-amber-400/80 bg-amber-500/20 shadow-amber-500/20"
    : "";
  const glyph = handEmojiForFingerCount(value);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick();
      }}
      className={`relative flex min-h-[132px] flex-1 flex-col overflow-hidden rounded-2xl border-2 bg-slate-800/80 p-2.5 text-left shadow-lg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 ${ring} ${hint} ${anim} ${sel}`}
    >
      <div className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <span
          className="pointer-events-none select-none text-5xl leading-none [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.35))]"
          aria-hidden
        >
          {glyph}
        </span>
        <div className="text-xl font-bold tabular-nums text-white">{value}</div>
      </div>
    </button>
  );
}

function HandRow({
  title,
  display,
  anim,
  row,
  humanDisplay,
  aiDisplay,
  rules,
  selectedIndex,
  hintedHands,
  onHandClick,
  disableClicks,
  opponentTappable,
}: {
  readonly title: string;
  readonly display: DisplayHands;
  readonly anim: AnimState;
  readonly row: "human" | "ai";
  readonly humanDisplay: DisplayHands;
  readonly aiDisplay: DisplayHands;
  readonly rules: Rules;
  readonly selectedIndex: 0 | 1 | null;
  readonly hintedHands: readonly [boolean, boolean];
  readonly onHandClick: (idx: 0 | 1) => void;
  readonly disableClicks: boolean;
  /** Opponent row: per-hand tap targets (implicit or selected-your-hand step). */
  readonly opponentTappable: readonly [boolean, boolean] | null;
}) {
  const [bLeft, bRight] = displayBumpsForRow(
    anim,
    row,
    humanDisplay,
    aiDisplay,
  );
  const splitClass =
    anim?.kind === "split" && anim.actor === row ? "animate-split" : "";
  const accent = row === "human" ? "sky" : "pink";
  const deadBlock = (i: 0 | 1) => {
    if (row === "human") {
      return display[i] === 0;
    }
    return !rules.deathAttack && display[i] === 0;
  };

  return (
    <div className={`rounded-3xl bg-slate-900/60 p-3.5 shadow-inner ${splitClass}`}>
      <div className="mb-2.5 text-center text-sm font-semibold text-slate-300">
        {title}
      </div>
      <div className="flex gap-2.5">
        <HandCard
          label="Left"
          value={display[0]}
          accent={accent}
          bump={bLeft}
          selected={selectedIndex === 0}
          hinted={hintedHands[0]}
          disabled={
            row === "human"
              ? disableClicks || deadBlock(0)
              : disableClicks || !(opponentTappable?.[0] ?? false)
          }
          onClick={() => onHandClick(0)}
        />
        <HandCard
          label="Right"
          value={display[1]}
          accent={accent}
          bump={bRight}
          selected={selectedIndex === 1}
          hinted={hintedHands[1]}
          disabled={
            row === "human"
              ? disableClicks || deadBlock(1)
              : disableClicks || !(opponentTappable?.[1] ?? false)
          }
          onClick={() => onHandClick(1)}
        />
      </div>
    </div>
  );
}

function formatSplitButtonLabel(lo: number, hi: number): string {
  return `${lo} · ${hi} (smaller left, larger right)`;
}

/** One button per distinct split; display is always smaller count on the left. */
function splitButtonChoices(legal: readonly Move[]): Array<{
  readonly move: Move & { readonly kind: "split" };
  readonly displayOrder: DisplayHands;
}> {
  const out: Array<{
    move: Move & { kind: "split" };
    displayOrder: DisplayHands;
  }> = [];
  const seenPack = new Set<number>();
  for (const m of legal) {
    if (m.kind !== "split") {
      continue;
    }
    const p = packMove(m);
    if (seenPack.has(p)) {
      continue;
    }
    seenPack.add(p);
    out.push({ move: m, displayOrder: [m.lo, m.hi] });
  }
  return out;
}

function isHintMove(move: Move | null, hints: readonly Move[]): boolean {
  return move !== null && hints.some((h) => movesEqual(h, move));
}

function attackHintHands(
  hints: readonly Move[],
  legal: readonly Move[],
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
): readonly [boolean, boolean] {
  const attackHints = hints.filter((h) => h.kind === "attack");
  if (attackHints.length === 0) {
    return [false, false];
  }

  const isHinted = (myDisp: 0 | 1) =>
    ([0, 1] as const).some((oppDisp) =>
      isHintMove(
        resolveHumanAttackOnOpponentDisplay(
          legal,
          humanDisplay,
          aiDisplay,
          myDisp,
          oppDisp,
        ),
        attackHints,
      ),
    );

  return [isHinted(0), isHinted(1)];
}

function attackHintTargets(
  hints: readonly Move[],
  legal: readonly Move[],
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
  selectedHumanHand: 0 | 1 | null,
): readonly [boolean, boolean] {
  if (selectedHumanHand === null) {
    return [false, false];
  }
  const attackHints = hints.filter((h) => h.kind === "attack");
  if (attackHints.length === 0) {
    return [false, false];
  }

  const isHinted = (oppDisp: 0 | 1) =>
    isHintMove(
      resolveHumanAttackOnOpponentDisplay(
        legal,
        humanDisplay,
        aiDisplay,
        selectedHumanHand,
        oppDisp,
      ),
      attackHints,
    );

  return [isHinted(0), isHinted(1)];
}

function formatHintMove(
  move: Move,
  rules: Rules,
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
): string {
  if (move.kind === "split") {
    return `Split -> ${move.lo}-${move.hi}`;
  }

  const attacker = engineHands(humanDisplay)[move.myHand];
  const target = engineHands(aiDisplay)[move.theirHand];
  if (attackResult(rules, target, attacker) === 0) {
    return `kill ${target}`;
  }
  return `Attack ${attacker}->${target}`;
}

/**
 * `scrollIntoView({ behavior: "smooth" })` can return a Promise on some browsers
 * that rejects (reason is sometimes an Event) → Next.js devtools reports
 * unhandledrejection as "[object Event]". Use instant scroll and absorb any thenable.
 */
function safeScrollIntoView(el: Element | null | undefined): void {
  if (el == null || !el.isConnected) {
    return;
  }
  try {
    const ret = el.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    }) as unknown;
    if (
      ret != null &&
      typeof ret === "object" &&
      typeof (ret as PromiseLike<unknown>).then === "function"
    ) {
      void (ret as PromiseLike<unknown>).then(undefined, () => {});
    }
  } catch {
    /* ignore */
  }
}

function humanLivingFingerCount(display: DisplayHands): number {
  return (display[0] > 0 ? 1 : 0) + (display[1] > 0 ? 1 : 0);
}

/**
 * Infer a legal attack when the attacker is obvious: equal addends, only one
 * living hand, or (non-rollover) two distinct hands that both knock the target to 0.
 */
function findImplicitOpponentAttack(
  legal: readonly Move[],
  rules: Rules,
  humanDisplay: DisplayHands,
  aiDisplay: DisplayHands,
  oppDisplayIdx: 0 | 1,
): Move | null {
  const thE = displayToEngineHand(aiDisplay, oppDisplayIdx);
  const hn = engineHands(humanDisplay);
  const oppNorm = engineHands(aiDisplay);
  const victimVal = oppNorm[thE];

  if (humanDisplay[0] === humanDisplay[1] && humanDisplay[0] > 0) {
    for (const myE of [0, 1] as const) {
      if (hn[myE] === 0) {
        continue;
      }
      const m = resolveAttackInLegalList(legal, myE, thE, oppNorm);
      if (m) {
        return m;
      }
    }
    return null;
  }

  if (humanLivingFingerCount(humanDisplay) === 1) {
    const liveIdx = (humanDisplay[0] > 0 ? 0 : 1) as 0 | 1;
    const myE = displayToEngineHand(humanDisplay, liveIdx);
    return resolveAttackInLegalList(legal, myE, thE, oppNorm);
  }

  if (!rules.rollover) {
    const killAttacks = legal.filter(
      (m): m is Extract<Move, { kind: "attack" }> =>
        m.kind === "attack" &&
        oppNorm[m.theirHand] === victimVal &&
        attackResult(rules, victimVal, hn[m.myHand]) === 0,
    );
    const distinctAttackers = new Set(killAttacks.map((m) => m.myHand));
    if (distinctAttackers.size >= 2) {
      return killAttacks[0]!;
    }
  }

  return null;
}

export function ChopsticksGame() {
  const [variant, setVariant] = useState<VariantId>("standard");
  const [draftVariant, setDraftVariant] = useState<VariantId>("standard");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [draftDifficulty, setDraftDifficulty] = useState<Difficulty>("medium");
  const [humanIsP1, setHumanIsP1] = useState(true);
  const [draftHumanIsP1, setDraftHumanIsP1] = useState(true);
  const [humanDisplay, setHumanDisplay] = useState<DisplayHands>([1, 1]);
  const [aiDisplay, setAiDisplay] = useState<DisplayHands>([1, 1]);
  const [humanToMove, setHumanToMove] = useState(true);
  const [gameOver, setGameOver] = useState<GameResult>(null);
  const [anim, setAnim] = useState<AnimState>(null);
  const [hintsOn, setHintsOn] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedHumanHand, setSelectedHumanHand] = useState<0 | 1 | null>(
    null,
  );
  const [splitPanelFlash, setSplitPanelFlash] = useState(false);

  const splitPanelRef = useRef<HTMLDivElement>(null);

  const rules: Rules =
    variant in RULES_BY_VARIANT ? RULES_BY_VARIANT[variant] : RULES_BY_VARIANT.standard;
  const table = STRATEGY_TABLES[variant] ?? STRATEGY_TABLES.standard;

  const reset = useCallback((nextHumanIsP1 = humanIsP1) => {
    const p = initialPosition();
    const h0 = nextHumanIsP1 ? p.current : p.opponent;
    const a0 = nextHumanIsP1 ? p.opponent : p.current;
    setHumanDisplay([h0[0], h0[1]]);
    setAiDisplay([a0[0], a0[1]]);
    setHumanToMove(nextHumanIsP1);
    setGameOver(null);
    setAnim(null);
    setSelectedHumanHand(null);
    setSplitPanelFlash(false);
  }, [humanIsP1]);

  useEffect(() => {
    if (!splitPanelFlash) {
      return;
    }
    safeScrollIntoView(splitPanelRef.current);
    const t = setTimeout(() => setSplitPanelFlash(false), 2200);
    return () => clearTimeout(t);
  }, [splitPanelFlash]);

  const posForHuman = useMemo(
    () => toPosition(humanDisplay, aiDisplay, humanToMove),
    [humanDisplay, aiDisplay, humanToMove],
  );

  const hintList = useMemo(() => {
    if (!hintsOn || gameOver || !humanToMove) {
      return [];
    }
    return hintMoves(posForHuman, rules, table);
  }, [hintsOn, gameOver, humanToMove, posForHuman, rules, table]);

  const legalHuman = useMemo(() => {
    if (!humanToMove || gameOver) {
      return [];
    }
    return legalMoves(posForHuman, rules);
  }, [humanToMove, gameOver, posForHuman, rules]);

  const splitChoices = useMemo(
    () => splitButtonChoices(legalHuman),
    [legalHuman],
  );

  const humanHintedHands = useMemo(
    () => attackHintHands(hintList, legalHuman, humanDisplay, aiDisplay),
    [hintList, legalHuman, humanDisplay, aiDisplay],
  );

  const aiHintedHands = useMemo(
    () =>
      attackHintTargets(
        hintList,
        legalHuman,
        humanDisplay,
        aiDisplay,
        selectedHumanHand,
      ),
    [hintList, legalHuman, humanDisplay, aiDisplay, selectedHumanHand],
  );

  const opponentTappable = useMemo((): readonly [boolean, boolean] => {
    if (!humanToMove || gameOver) {
      return [false, false];
    }
    const leftDead = aiDisplay[0] === 0 && !rules.deathAttack;
    const rightDead = aiDisplay[1] === 0 && !rules.deathAttack;
    const selectingOwnHand = selectedHumanHand !== null;
    const canTap = (oppDisp: 0 | 1) => {
      if (oppDisp === 0 ? leftDead : rightDead) {
        return false;
      }
      if (!selectingOwnHand) {
        return (
          findImplicitOpponentAttack(
            legalHuman,
            rules,
            humanDisplay,
            aiDisplay,
            oppDisp,
          ) !== null
        );
      }
      return (
        resolveHumanAttackOnOpponentDisplay(
          legalHuman,
          humanDisplay,
          aiDisplay,
          selectedHumanHand,
          oppDisp,
        ) !== null
      );
    };
    return [canTap(0), canTap(1)];
  }, [
    humanToMove,
    gameOver,
    aiDisplay,
    selectedHumanHand,
    legalHuman,
    humanDisplay,
    rules,
  ]);

  const aiToken = useRef(0);

  useEffect(() => {
    if (gameOver || humanToMove) {
      return;
    }
    const token = ++aiToken.current;
    const delay = setTimeout(() => {
      if (token !== aiToken.current) {
        return;
      }
      const pos: Position = {
        current: engineHands(aiDisplay),
        opponent: engineHands(humanDisplay),
      };
      let move: Move;
      try {
        move = chooseAiMove(difficulty, pos, rules, table);
      } catch {
        return;
      }
      if (
        !move ||
        typeof move !== "object" ||
        (move.kind !== "attack" && move.kind !== "split")
      ) {
        return;
      }

      if (move.kind === "attack") {
        setAnim({
          kind: "attack",
          actor: "ai",
          myHand: move.myHand,
          theirHand: move.theirHand,
        });
      } else {
        setAnim({ kind: "split", actor: "ai" });
      }
      setTimeout(() => setAnim(null), 600);

      const next = applyMove(pos, move, rules);
      if (move.kind === "attack") {
        const an = engineHands(aiDisplay);
        const attackerVal = an[move.myHand];
        const hitDisp = engineToDisplayHandIndex(humanDisplay, move.theirHand);
        const newT = attackResult(rules, humanDisplay[hitDisp], attackerVal);
        setHumanDisplay(
          hitDisp === 0
            ? [newT, humanDisplay[1]]
            : [humanDisplay[0], newT],
        );
      } else {
        setHumanDisplay((prev) => alignDisplayToNorm(prev, next.current));
        setAiDisplay((prev) => alignDisplayToNorm(prev, next.opponent));
      }
      setHumanToMove(true);
      setSelectedHumanHand(null);

      if (isDead(next.current)) {
        setGameOver("ai");
      }
    }, 550);
    return () => clearTimeout(delay);
  }, [
    gameOver,
    humanToMove,
    humanDisplay,
    aiDisplay,
    difficulty,
    rules,
    table,
  ]);

  function applyHumanMove(
    move: Move,
    nextHumanDisplay?: DisplayHands,
    attackDisplay?: { readonly attacker?: 0 | 1; readonly victim?: 0 | 1 },
  ) {
    if (!humanToMove || gameOver) {
      return;
    }
    if (move.kind === "attack") {
      setAnim({
        kind: "attack",
        actor: "human",
        myHand: move.myHand,
        theirHand: move.theirHand,
        myDisplayIdx: attackDisplay?.attacker,
        theirDisplayIdx: attackDisplay?.victim,
      });
    } else {
      setAnim({ kind: "split", actor: "human" });
    }
    setTimeout(() => setAnim(null), 600);

    const next = applyMove(posForHuman, move, rules);

    if (move.kind === "attack") {
      const hn = engineHands(humanDisplay);
      const attackerVal = hn[move.myHand];
      const hitDisp =
        attackDisplay?.victim ??
        engineToDisplayHandIndex(aiDisplay, move.theirHand);
      const newT = attackResult(rules, aiDisplay[hitDisp], attackerVal);
      setAiDisplay(
        hitDisp === 0 ? [newT, aiDisplay[1]] : [aiDisplay[0], newT],
      );
    } else if (nextHumanDisplay) {
      setHumanDisplay(nextHumanDisplay);
      setAiDisplay((prev) => alignDisplayToNorm(prev, next.current));
    } else {
      setHumanDisplay((prev) => alignDisplayToNorm(prev, next.opponent));
      setAiDisplay((prev) => alignDisplayToNorm(prev, next.current));
    }

    setHumanToMove(false);
    setSelectedHumanHand(null);

    if (isDead(next.current)) {
      setGameOver("human");
    }
  }

  function onHumanHandClick(idx: 0 | 1) {
    if (!humanToMove || gameOver) {
      return;
    }
    if (humanDisplay[idx] === 0) {
      return;
    }

    if (selectedHumanHand === null) {
      setSelectedHumanHand(idx);
      return;
    }

    if (selectedHumanHand === idx) {
      setSelectedHumanHand(null);
      return;
    }

    const splits = legalHuman.filter((m) => m.kind === "split");
    if (splits.length === 1) {
      applyHumanMove(splits[0]!);
      return;
    }
    if (splits.length === 0) {
      setSelectedHumanHand(null);
      return;
    }
    setSplitPanelFlash(true);
    setSelectedHumanHand(null);
  }

  function onAiHandClick(idx: 0 | 1) {
    if (!humanToMove || gameOver) {
      return;
    }
    if (aiDisplay[idx] === 0 && !rules.deathAttack) {
      return;
    }

    if (selectedHumanHand !== null) {
      const move = resolveHumanAttackOnOpponentDisplay(
        legalHuman,
        humanDisplay,
        aiDisplay,
        selectedHumanHand,
        idx,
      );
      if (!move) {
        setSelectedHumanHand(null);
        return;
      }
      applyHumanMove(move, undefined, {
        attacker: selectedHumanHand,
        victim: idx,
      });
      return;
    }

    const implicit = findImplicitOpponentAttack(
      legalHuman,
      rules,
      humanDisplay,
      aiDisplay,
      idx,
    );
    if (implicit) {
      applyHumanMove(implicit, undefined, { victim: idx });
    }
  }

  function onSplitButton(
    move: Move & { kind: "split" },
    order: DisplayHands,
  ) {
    if (!humanToMove || gameOver) {
      return;
    }
    if (!moveInList(move, legalHuman)) {
      return;
    }
    applyHumanMove(move, order);
  }

  const disableHandClicks = !humanToMove || !!gameOver;

  return (
    <>
    <div className="grid gap-5 lg:grid-cols-[1fr_304px]">
      <div className="flex flex-col gap-3.5">
        <HandRow
          title={humanIsP1 ? "Player 2 (computer)" : "Player 1 (computer)"}
          display={aiDisplay}
          anim={anim}
          row="ai"
          humanDisplay={humanDisplay}
          aiDisplay={aiDisplay}
          rules={rules}
          selectedIndex={null}
          hintedHands={aiHintedHands}
          onHandClick={onAiHandClick}
          disableClicks={disableHandClicks}
          opponentTappable={opponentTappable}
        />
        <div className="relative py-1.5 text-center text-xs uppercase tracking-[0.25em] text-slate-500">
          VS
        </div>
        <HandRow
          title={humanIsP1 ? "Player 1 (you)" : "Player 2 (you)"}
          display={humanDisplay}
          anim={anim}
          row="human"
          humanDisplay={humanDisplay}
          aiDisplay={aiDisplay}
          rules={rules}
          selectedIndex={selectedHumanHand}
          hintedHands={humanHintedHands}
          onHandClick={onHumanHandClick}
          disableClicks={disableHandClicks}
          opponentTappable={null}
        />

        <div
          ref={splitPanelRef}
          className={`mx-auto w-full max-w-lg rounded-2xl border p-2.5 text-center transition ${
            splitPanelFlash
              ? "border-amber-400/90 bg-amber-500/10 shadow-[0_0_24px_rgba(251,191,36,0.25)]"
              : "border-slate-600 bg-slate-900/50"
          }`}
        >
          <div className="text-sm font-semibold text-slate-200">
            Splits / redistributions
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Same total fingers; smaller count is always shown on your left after the split.
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            {splitChoices.length === 0 ? (
              <span className="text-sm text-slate-500">None legal right now.</span>
            ) : (
              splitChoices.map(({ move, displayOrder }) => {
                const key = `${packMove(move)}-${displayOrder[0]}-${displayOrder[1]}`;
                const hinted =
                  hintsOn &&
                  hintList.some(
                    (h) => h.kind === "split" && movesEqual(h, move),
                  );
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disableHandClicks}
                    onClick={() => onSplitButton(move, displayOrder)}
                    className={`rounded-xl border px-2.5 py-1.5 text-center text-sm font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
                      hinted
                        ? "border-amber-400/80 bg-amber-500/20 text-amber-100"
                        : "border-slate-600 bg-slate-800 text-slate-100"
                    }`}
                  >
                    {formatSplitButtonLabel(move.lo, move.hi)}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {(!humanToMove || gameOver) && (
          <div className="rounded-3xl border border-slate-700 bg-slate-900/50 p-3.5 text-center">
            {!humanToMove && !gameOver && (
              <p className="text-slate-400">Computer is thinking…</p>
            )}
            {gameOver && (
              <p className="text-lg font-bold text-amber-300">
                {gameOver === "human" ? "You win!" : "Computer wins!"}
              </p>
            )}
          </div>
        )}
      </div>

      <aside className="flex h-fit flex-col gap-3.5 rounded-3xl border border-slate-700 bg-slate-900/70 p-4 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-white">Game</h2>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-lg border border-slate-600 px-2.5 py-1 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            How to move
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Variant</span>
          <select
            className="rounded-xl border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-slate-100"
            value={draftVariant}
            onChange={(e) =>
              setDraftVariant(e.currentTarget.value as VariantId)
            }
          >
            {VARIANT_ORDER.map((v) => (
              <option key={v} value={v}>
                {VARIANT_LABEL[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Computer strength</span>
          <select
            className="rounded-xl border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-slate-100"
            value={draftDifficulty}
            onChange={(e) =>
              setDraftDifficulty(e.currentTarget.value as Difficulty)
            }
          >
            <option value="easy">Easy — uniform random</option>
            <option value="medium">
              Medium — no instant blunders; instant wins
            </option>
            <option value="hard">
              Hard — mate-in-3 wins; no mate-in-3 losses
            </option>
            <option value="master">Master — table-optimal</option>
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="text-slate-400">You play as</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="p"
              checked={draftHumanIsP1}
              onChange={() => setDraftHumanIsP1(true)}
            />
            Player 1 (starts)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="p"
              checked={!draftHumanIsP1}
              onChange={() => setDraftHumanIsP1(false)}
            />
            Player 2
          </label>
        </fieldset>

        <button
          type="button"
          onClick={() => {
            setVariant(draftVariant);
            setDifficulty(draftDifficulty);
            setHumanIsP1(draftHumanIsP1);
            reset(draftHumanIsP1);
          }}
          className="rounded-xl bg-gradient-to-r from-pink-500 to-sky-500 px-3.5 py-1.5 font-semibold text-white shadow-lg hover:opacity-95"
        >
          New game
        </button>

        <div className="border-t border-slate-700 pt-3.5">
          <button
            type="button"
            aria-pressed={hintsOn}
            onClick={() => setHintsOn((x) => !x)}
            className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              hintsOn
                ? "border-amber-400/80 bg-amber-500/20 text-amber-100"
                : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            Show engine moves
          </button>
        </div>

        <div className="text-sm text-slate-300">
          <div className="font-semibold text-slate-200">Engine</div>
          {humanToMove && !gameOver ? (
            <>
              <p className="mt-1 text-slate-400">
                Your turn classification:{" "}
                <span className="text-slate-200">
                  {(() => {
                    const idx = positionIndex(posForHuman, rules);
                    const r = table[idx];
                    if (!r) {
                      return "—";
                    }
                    return (
                      <>
                        {rowOutcome(r[0])}{" "}
                        {r[1] >= 0 ? `(depth ${r[1]})` : ""}
                      </>
                    );
                  })()}
                </span>
              </p>
              {hintsOn && (
                <ul className="mt-2 list-inside list-disc text-slate-400">
                  {hintList.length === 0 ? (
                    <li>No hints</li>
                  ) : (
                    hintList.map((h) => (
                      <li key={moveKey(h)} className="text-amber-200/90">
                        {formatHintMove(h, rules, humanDisplay, aiDisplay)}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-slate-500">
              {gameOver
                ? "Game over — start a new game."
                : "Computer move — analysis shows the position the AI is solving."}
            </p>
          )}
        </div>
      </aside>
    </div>
    {helpOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3.5">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-to-move-title"
          className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 id="how-to-move-title" className="text-lg font-bold text-white">
              How to move
            </h2>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="rounded-lg border border-slate-600 px-2.5 py-1 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Tap one of <em>your</em> hands, then an <em>opponent</em> hand to{" "}
            <strong>attack</strong>. When the opponent shows the same count on
            both sides, either hand is a valid target—the board keeps your
            left/right as tapped.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            You can skip picking your hand when it is obvious:{" "}
            <em>both your counts match</em>, you only have{" "}
            <em>one living hand</em>, or (standard / death-attack, no rollover){" "}
            <em>either hand would knock that opponent hand out</em>.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Tap your <em>other</em> hand to focus <strong>splits</strong> below
            the player hands. If only one redistribution exists, it plays
            automatically. Hands stay left/right as you see them; the engine
            uses normalized counts internally.
          </p>
        </div>
      </div>
    )}
    </>
  );
}
