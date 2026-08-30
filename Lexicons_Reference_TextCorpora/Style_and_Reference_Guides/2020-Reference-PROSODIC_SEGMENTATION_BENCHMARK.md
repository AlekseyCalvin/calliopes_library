# Prosodic Segmentation Benchmark — κ/ϕ/ι bracketing integrity

Comparison of phonological-hierarchy bracketing across five implementations, over the
test fragments McAleese uses (thesis pp. 212–214) plus extensions. Run **after** the
genuine phrase-stress layer (cyclic Compound + Nuclear Stress Rules, `bracketing.ts`)
was integrated (2026-06-21).

**Bracketing notation:** `<…>` intonational unit (ι), `{…}` phonological phrase (ϕ),
`[…]` clitic group (κ). **Phrase stress:** integers, **1 = strongest** (utterance
nuclear), higher = weaker — the genuine cyclic CSR/NSR ranking.

Baselines (from the maintainer's hand comparison):
- **Expert** — expert hand-segmentation.
- **McAlliope** — McAleese's original Calliope (Antelope NLP).
- **0.0.1** — Calliope-TS published on npm (oldest).
- **pre-PS** — Calliope-TS this session BEFORE phrase stress (the maintainer's "current").
- **NOW** — Calliope-TS this session WITH genuine phrase stress (bracketing unchanged
  from pre-PS on these lines; phrase-stress integers added).

> **Key finding up front:** the phrase-stress integration did **not** alter the κ/ϕ/ι
> bracketing — that is still built by `prosodic.ts` from POS + relations, *not* from the
> new dependency-constituent tree in `bracketing.ts`. So every bracketing defect the
> maintainer flagged in "pre-PS" **persists in NOW**. The genuine fix for the structural
> defects (clause flattening, verb-group separation) is to **derive ϕ from the same
> dependency bracketing the stress rules already use** — the next step.

---

## 1. "It was thought of constantly"
- **Expert:**   `<{[it was thought of]}{[constantly]}>`
- **McAlliope:** `{[It was thought]}{[of constantly]}`  *(McAleese admits WRONG)*
- **0.0.1:**    `<{[it thought of][ was][ constantly]}>`  *(no ϕ split, but keeps "thought of")*
- **pre-PS:**   `<{[it was thought]}{[ of constantly]}>`  *(WRONG)*
- **NOW:**      `<{[it was thought]}{[ of constantly]}>`  · phr `it2 was3 thought5 of4 constantly1`
- **Verdict:** ✗ **unchanged, still WRONG.** "of" is the particle of the phrasal verb
  "thought of" and must stay with "thought"; instead it opens a ϕ with the adverb
  "constantly". Cause: `opensPhrase` treats the stranded `IN` "of" as a preposition that
  opens an oblique ϕ, but here "of" governs nothing (constantly is ADVMOD, not its
  object). **Fix target:** a preposition with no nominal object (a stranded particle)
  must NOT open a ϕ; it encliticises left onto its verb. *(0.0.1 alone kept "thought of"
  together — worth co-opting.)*  Phrase stress also mis-ranks: passive main verb
  "thought"=5 is over-demoted under the clause-final adverb.

## 2. "This is the cat that caught the rat that stole the cheese"
- **Expert:**   `{This is the cat}{that caught the rat}{that stole the cheese}`
- **McAlliope:** `{[This is the cat]}{[that caught]}{[the rat]}{[that stole][the cheese]}`
- **0.0.1:**    `<{[this that caught][ is]}{[ the cat]}{[ the rat]}{[ that stole]}{[ the cheese]}>` *(WRONG — conflates this/that, cat/rat)*
- **pre-PS / NOW:** `<{[this is the cat]}{[ that caught][ the rat]}{[ that stole][ the cheese]}>`  · phr `this2 is3 the5 cat4 that5 caught7 the8 rat6 that7 stole8 the9 cheese1`
- **Verdict:** ✓ **GOOD — arguably closer than McAleese.** Clean relative-clause ϕ
  splits. Phrase stress: cheese=1 (rightmost nuclear), the three clause heads (cat 4,
  rat 6) ranked sensibly. **Keep.**

## 3. "In Pakistan, Tuesday, which is a weekday, is a holiday"
- **Expert:**   `{In Pakistan},{Tuesday},{which is a weekday},{is a holiday}`
- **McAlliope:** `<{[In Pakistan]}><{[Tuesday]}><{[which is a weekday]}><{[is a holiday]}>`
- **0.0.1:**    `<{[in Pakistan]}><{[ Tuesday]}><{[ which][ is]}{[ a weekday]}><{[ is]}{[ a holiday]}>` *(adds ι at punctuation — closer)*
- **pre-PS / NOW:** `<{[in Pakistan]}{[ Tuesday]}{[ which is a weekday]}{[ is][ a holiday]}>`  · phr `in3 Pakistan2 Tuesday3 which4 is5 a7 weekday6 is7 a8 holiday1`
- **Verdict:** ~ **OKAY but coarse.** ϕ splits are right, but commas should arguably be ι
  (intonational) breaks here — apposition + non-restrictive relative clause are classic ι
  boundaries. We demote all commas to ϕ. **Tension with the dash=ι / comma=ϕ rule:** a
  *non-restrictive* comma (appositive, parenthetical relative) is stronger than a list
  comma. Candidate refinement: comma flanking an appositive/ACL → ι. *(0.0.1's IU breaks
  are closer here.)*

## 4. "Given the chance, rabbits reproduce quickly"
- **Expert:**   `<{[Given][the chance]}>,<{[rabbits]}{[reproduce][quickly]}>`
- **McAlliope:** `{[Given][the chance]}{[rabbits]}{[reproduce][quickly]}`
- **pre-PS / NOW:** `<{[given][ the chance]}{[ rabbits]}{[ reproduce][ quickly]}>`  · phr `given3 the4 chance2 rabbits3 reproduce4 quickly1`
- **0.0.1:**    `<{[given][ the chance]}><{[ rabbits][ reproduce][ quickly]}>` *(WRONG — misses rabbits|reproduce ϕ split)*
- **Verdict:** ✓ **GOOD — matches McAleese, real progress over 0.0.1** (which missed the
  subject|predicate ϕ split we now make). Same ι-at-comma caveat as #3.

## 5. "more than fifteen carpenters are working in the house"
- **Expert:**   `<{[More than fifteen carpenters]}{[are working]}{[in the house]}>`
- **McAlliope:** `{[More][than fifteen][carpenters]}{[are working]}{[in the house]}`
- **pre-PS / NOW:** `<{[more]}{[ than fifteen][ carpenters][ are working]}{[ in the house]}>`  · phr `more2 than3 fifteen5 carpenters4 are5 working6 in7 the8 house1`
- **0.0.1:**    `<{[more][ than working][ are]}{[ fifteen][ carpenters]}{[ in the house]}>` *(WRONG, scrambled)*
- **Verdict:** ✗ **WRONG (two defects).** (a) "more" is split off as its own ϕ — it should
  head the subject NP "more than fifteen carpenters"; (b) "are working" (verb group) is
  glued INTO the subject ϕ instead of being its own ϕ. Cause: same as #11 — the aux+verb
  group doesn't open a ϕ because the predicate head is mis-handled. **Fix target:** verb
  group opens a ϕ after a nominal subject.

## 6. "Please leave them alone"
- **Expert:**   `[Please][leave them][alone]`
- **McAlliope:** `{[Please]}{[leave]}{[them alone]}`  *(McAleese admits WRONG)*
- **pre-PS / NOW:** `<{[please][ leave them][ alone]}>`  · phr `please2 leave4 them3 alone1`
- **0.0.1:**    `<{[please leave them][ alone]}>` *(WRONG)*
- **Verdict:** ✓ **GOOD — better than McAleese.** Clitic groups right (object "them"
  enclitic on "leave"; "alone" its own κ). **Keep.**

## 7. "The curfew tolls the knell of parting day"
- **Expert:**   `[The curfew][tolls][the knell][of parting][day]`
- **McAlliope:** `{[The curfew]}{[tolls]}{[the knell]}{[of parting][day]}`
- **pre-PS / NOW:** `<{[the curfew][ tolls][ the knell]}{[ of parting][ day]}>`  · phr `the3 curfew1 tolls3 the5 knell4 of5 parting2 day6`
- **0.0.1:**    `<{[the curfew]}{[ tolls][ of day][ parting]}{[ the knell]}>` *(scrambled)*
- **Verdict:** ~ **OKAY but under-segmented.** Expert/McAleese give "tolls" and "the
  knell" their own ϕ; we glue curfew+tolls+knell into one ϕ (only the oblique "of
  parting day" splits off). Also phrase stress is **WRONG here**: curfew=1 outranks the
  whole rest, and "day"=6 (weakest) though it is the line's rightmost head — the parse
  mis-rooted the line (likely "curfew" as root), so the NSR nuclear landed wrong. A
  diagnostic of parse-quality dependence.

## 8. "When you are old and gray and full of sleep"
- **Expert:**   `<{[WHEN you]}{[are old]}{[and gray]}><{[and full]}{[of sleep]}>`
- **McAlliope:** `<{[When]}{[you are old]}{[and gray and]}{[full]}{[of sleep]}>`  *(WRONG)*
- **pre-PS / NOW:** `<{[when][ you are][ old]}{[ and gray]}{[ and full]}{[ of sleep]}>`  · phr `when2 you3 are7 old6 and7 gray5 and6 full4 of5 sleep1`
- **0.0.1:**    `<{[when you are][ old][ and gray][ and full]}{[ of sleep]}>` *(WRONG)*
- **Verdict:** ~ **closer than McAleese, one clitic defect.** The coordinate ϕ (and gray /
  and full / of sleep) are right. BUT "you are" is grouped as one κ — expert wants "WHEN
  you" | "are old" (subject pronoun "you" leans LEFT onto "when"; "are" leans onto "old").
  Cause: subject pronoun "you" procliticises rightward onto "are" instead of encliticising
  onto the preceding wh-word. **Fix target:** a subject pronoun after a wh-word/comp can
  lean left. Same defect in 0.0.1.

## 9. "Nature's first green is gold,"
- **Expert:**   `<{[Nature's][first][green]}{[is gold]}>`
- **McAlliope:** `<{[Nature 's][first][green]}{[is gold]}>`  *(on point)*
- **pre-PS / NOW:** `<{[Nature first][ green][ is][ gold]}>`  · phr `Nature2 first4 green3 is4 gold1`
- **0.0.1:**    `<{[Nature] is[ first][ green][ gold]}>` *(WRONG, different)*
- **Verdict:** ✗ **UTTERLY WRONG — the possessive `'s` is destroyed.** "Nature's" loses its
  `'s`, "Nature" + "first" glue into one κ, the NP collapses, and there is NO ϕ split
  before "is gold". This is a **core grammatical failure** (possessive marking). **Highest-
  priority fix:** preserve `'s` as a `POS` enclitic on "Nature", so "Nature's" heads the
  subject NP and "is gold" forms its own ϕ.

## 10. "The invisible worm that flies in the night in the howling storm"
- **Expert:**   `{[The invisible][worm]}{[that flies][in the night]}{[in the howling][storm]}`
- **McAlliope:** `{[The invisible][worm that]}{[flies]}{[in the night]}{[in the howling][storm]}`
- **pre-PS / NOW:** `<{[the invisible][ worm]}{[ that flies]}{[ in the night]}{[ in the howling][ storm]}>`  · phr `the3 invisible4 worm2 that3 flies5 in6 the7 night4 in5 the6 howling7 storm1`
- **0.0.1:**    `<{[the worm][ invisible]}{[ that flies]}{[ in the night]}{[ in the storm][ howling]}>` *(word-order scrambles)*
- **Verdict:** ✓ **GOOD.** ϕ splits match the expert (NP | relative clause | oblique PP |
  oblique PP). Clitic order correct (unlike 0.0.1, which scrambles invisible/worm and
  howling/storm). **Keep — one of our best.**

## 11. "The absent-minded professor has been avidly reading the latest biography of Marcel Proust"
- **Expert:**   `<<{The absent-minded professor}> <{has been avidly reading}> <{the latest biography}{of Marcel Proust}>>`
- **McAlliope:** `{[The absent-minded][professor]}{[has been avidly][reading][biography of][the latest]}{[Marcel][Proust]}`
- **pre-PS / NOW:** `<{[the absent-minded][ professor][ has been][ avidly][ reading][ the latest][ biography]}{[ of Marcel][ Proust]}>`  · phr `the3 absent-minded4 professor2 has6 been7 avidly8 reading6 the7 latest4 biography9 of5 Marcel1 Proust1`
- **0.0.1:**    `<{[the professor][ absent-minded][ has][ been]}{[ avidly][ reading]}{[ the biography][ latest]}{[ of Marcel][ Proust]}>` *(4 ϕ — finer)*
- **Verdict:** ✗ **WRONG — clause FLATTENED.** Subject NP + verb group + object NP all
  collapse into one giant ϕ1; only "of Marcel Proust" splits off. Expert wants three top
  units: {subject}{verb group}{object}. Cause: en-pos tags "reading" as **NN** (not VBG),
  so the aux chain "has been avidly" attaches to it as if it were a noun head, and
  `opensPhrase` (which only breaks before a *finite verb* head) sees a noun and never
  breaks. **0.0.1 was finer here** (4 ϕ). Also phrase stress is degraded: "Marcel"=1 and
  "Proust"=1 tie (the proper-name span), but the clause's real nucleus (reading/biography)
  is buried. **Fix target:** (a) verb group (aux+participle) opens a ϕ; (b) object NP opens
  a ϕ; ideally derive ϕ from the dependency tree so a mis-tagged "reading" still heads a
  verb group via its `dobj`/`aux` relations.

## 12. "The convoy, slipped through the cracks, will gag the windows with grass"
- **pre-PS / NOW:** `<{[the convoy]}{[ slipped]}{[ through the cracks]}{[ will gag][ the windows]}{[ with grass]}>`  · phr `the3 convoy2 slipped4 through5 the6 cracks3 will4 gag6 the7 windows5 with6 grass1`
- **0.0.1:**    `<{[the convoy]}><{[ slipped]}{[ through the cracks]}><{[ will gag]}{[ the windows]}{[ with grass]}>`
- **Verdict:** ~ **ϕ structure OKAY.** Phrase stress NOW genuine (`grass1` nuclear,
  `convoy2` subject), replacing the old fake monotone ramp `1 2 3 1 1 4 1 5 1 6 1 7`.
  0.0.1 added ι breaks at the commas (parenthetical "slipped through the cracks").

---

## Summary of defects (priority order)

| # | Defect | Lines | Cause | Tractability |
|---|--------|-------|-------|--------------|
| A | **Possessive `'s` destroyed** | 9 | tokenizer drops/merges `'s`; no POS enclitic | **high — clear fix** |
| B | **Clause flattening** (subject+verb+object in one ϕ) | 5, 11 | verb group doesn't open a ϕ; aux attaches to mis-tagged NN head; `opensPhrase` only breaks before a finite-verb head | medium — needs dep-driven ϕ |
| C | **Stranded particle opens a ϕ** ("of" leaves "thought") | 1 | objectless `IN` treated as oblique-PP onset | medium |
| D | **Subject pronoun grouped with copula** ("you are") | 8 | subject PRP procliticises right instead of leaning left onto wh | medium |
| E | **Non-restrictive comma should be ι** (apposition/ACL) | 3 | all commas demoted to ϕ | low — refinement |

**Verdicts tally (NOW vs expert):** GOOD ✓ — #2, #4, #6, #10 (4); OKAY ~ — #3, #7, #8, #12
(4); WRONG ✗ — #1, #5, #9, #11 (4). Several are clear progress over both 0.0.1 and
McAleese (#2, #4, #6); the WRONG set is dominated by **possessive `'s` (A)** and **clause
flattening (B)**, both of which point to the same remedy: **build ϕ from the dependency
constituent tree** (already computed in `bracketing.ts` for stress) instead of the
POS-only `opensPhrase` heuristic.

---

## Fixes applied this session (2026-06-21)

**A — possessive `'s` (display.ts).** Root cause was a *display* bug: the bracketing
renderer iterates syllable columns, and `'s` is a 0-syllable token, so the κ it closed
(`[Nature 's]`) never emitted its close-bracket and "first" was absorbed → the bogus
`[Nature first]`. Fixed by (1) attaching the `'s` surface to the preceding syllable's
chunk so it renders, and (2) computing κ/ϕ/ι boundary flags by look-around over
syllable-bearing columns so a 0-syllable token can never swallow a boundary.
- #9 NOW: `<{[Nature's][ first][ green][ is][ gold]}>` ✓ — `'s` shows, κ structure correct.
  (Still missing the ϕ split before "is gold" — that is the bad PARSE: "green"→amod→"is",
  the subject NP never forms. Parse-quality, not display.)

**B — clause flattening (prosodic.ts `opensPhrase`).** The predicate's verb group now
opens its own ϕ after a full nominal subject even when it begins with an AUXILIARY
(previously it broke only before a finite-verb *head*, so an aux chain attaching to a
mis-tagged participle head flattened the clause).
- #5 NOW: `<{[more]}{[ than fifteen][ carpenters]}{[ are working]}{[ in the house]}>` —
  "are working" is now its own ϕ ✓ (only "more" mis-split remains).
- #11 NOW: `<{[the absent-minded][ professor]}{[ has been][ avidly][ reading][ the latest][ biography]}{[ of Marcel][ Proust]}>` —
  the subject NP is now split from the predicate ✓ (verb group + object NP still glued —
  needs object-NP ϕ onset; best done via the dependency tree).

**Impact:** tests 90/98 (same 8 pre-existing failures, none new); only **1/155** corpus
meter-IDs shifted from the `opensPhrase` change. Lines #1, #2, #3, #4, #6, #7, #8, #10, #12
unchanged.

## Still open (next, all point to dep-driven ϕ)
- **C** stranded particle "of" opens a ϕ (#1) — needs objectless-preposition detection.
- **D** "you are" clitic grouping (#8) — subject pronoun should lean left onto wh.
- **B-residual** object NP should open its own ϕ (#11) — verb group | object split.
- **E** non-restrictive comma → ι (#3).
- The principled fix for B/C/B-residual is to **derive ϕ-boundaries from the dependency
  constituent tree** (`bracketing.ts`), which already knows verb-group vs object-NP vs
  oblique-PP from the relations — rather than extending the POS-keyed `opensPhrase`. The
  remaining hard cases (#7, #9) are genuinely bad en-parses upstream of any ϕ logic.

---

## THE UNIFICATION — ϕ derived from the dependency constituent tree (2026-06-21)

The POS-keyed `opensPhrase` heuristic is **gone**.  ϕ-boundaries are now derived from the
SAME dependency constituent structure the cyclic stress rules use: `computePhiDomains`
(`bracketing.ts`) UNION-s every word with its governor across **ϕ-internal** edges
(det/aux/case/amod/advmod/compound/particle …) and opens a new ϕ at every **ϕ-projecting**
edge — a FULL-NOMINAL subject (a pronoun subject incorporates), a BRANCHING object (a light
DET+N object incorporates; a copula's predicate nominal stays), an oblique PP, a clause
(CCOMP/XCOMP/ADVCL/ACL), a conjunct.  Two **parse-robust** Table-1 markers supplement it for
the cases en-parse mis-attaches: a **coordinator** (CC) and a **relative pronoun** (WDT/WP)
each open a ϕ (en-parse flattens "old and gray and full" into AMODs and drops relative
clauses, but the CC and WDT tokens survive).  Notation as above; **NEW′** = post-unification.

| # | Expert | NEW′ (dependency-driven) | vs prior NOW |
|---|--------|--------------------------|--------------|
| 1 | `{it was thought of}{constantly}` | `{[it was thought][of constantly]}` | ✓ **C FIXED** — "of" no longer strays into a spurious oblique ϕ (1 ϕ; misses only the expert's `constantly` split, which would need clause-final-ADVMOD→ϕ and conflicts with #4) |
| 2 | `{This is the cat}{that caught the rat}{that stole the cheese}` | `{[this is the cat]}{[that caught][the rat]}{[that stole][the cheese]}` | ✓ **EXACT** (relativiser-marker recovered it though en-parse flattened the relatives: cat=IOBJ, rat=DOBJ) |
| 3 | `{In Pakistan},{Tuesday},{which is a weekday},{is a holiday}` | `{[in Pakistan]}{[Tuesday]}{[which is a weekday]}{[is][a holiday]}` | ~ unchanged (E: commas should be ι — still open) |
| 4 | `{Given the chance}{rabbits}{reproduce quickly}` | `{[given][the chance]}{[rabbits]}{[reproduce][quickly]}` | ✓ **EXACT** (preserved) |
| 5 | `{More than fifteen carpenters}{are working}{in the house}` | `{[more]}{[than fifteen][carpenters]}{[are working]}{[in the house]}` | ✓ verb-group now its own ϕ (was glued into subject); only "more" mis-split remains (parse: more→working AMOD) |
| 6 | `[Please][leave them][alone]` | `{[please][leave them][alone]}` | ✓ (preserved) |
| 7 | `{the curfew}{tolls}{the knell}{of parting day}` | `{[the curfew][tolls][the knell][of parting][day]}` | ✗ **regressed to 1 ϕ** — parse roots the whole line on "day" as a noun-pile (curfew/tolls/knell all →day); no ϕ logic recovers a noun-pile parse |
| 8 | `{WHEN you}{are old}{and gray}{and full}{of sleep}` | `{[when][you are][old]}{[and gray]}{[and full]}{[of sleep]}` | ✓ coordinate ϕ correct (CC marker); only the you\|are clitic split (D) remains |
| 9 | `{Nature's first green}{is gold}` | `{[Nature 's][first][green][is][gold]}` | ~ unchanged — bad parse (green→amod→is, subject NP never forms) |
| 10 | `{The invisible worm}{that flies in the night}{in the howling storm}` | `{[the invisible][worm]}{[that flies]}{[in the night]}{[in the howling][storm]}` | ✓ (preserved — one of the best) |
| 11 | `{The absent-minded professor}{has been avidly reading}{the latest biography}{of Marcel Proust}` | `{[the absent-minded][professor]}{[has been]}{[avidly][reading]}{[the latest][biography]}{[of Marcel]}{[Proust]}` | ◐ **subject NP ✓ + object NP ✓ (B-residual addressed)**; verb group fragmented + name split (parse: Marcel→reading OBL, Proust→been DOBJ tore the name span apart) |
| 12 | — | `{[the convoy]}{[slipped]}{[through the cracks]}{[will gag][the windows]}{[with grass]}` | ~ OKAY (preserved) |

**Net vs prior NOW:** improved #1 (C), #5 (verb-group), #11 (subject+object); **#2 and #4 now
match the expert exactly**; #6/#8/#10 held.  Only **#7 regressed** (1 ϕ), and only because its
parse is a noun-pile — the faithful dep-driven ϕ honestly exposes parse quality instead of
masking it with the old IN-opens-ϕ crutch (which had *hurt* #1).  The dominant WRONG-set
defects (clause flattening B, possessive A, stranded particle C) are resolved or parse-bound.

**Still parse-bound (Stage-1 work, not ϕ logic):** #7 noun-pile root; #9 green→amod→is; #11
name-span tear; #5 more→working.  These need depfix/tagfix repair upstream.

**Relativiser fix (same session):** a prominent pronoun/quantifier (functionLevel ≠ x) now
outranks a reduced auxiliary for the ϕ nuclear — "…have it—it is **THEIRS**" gave its beat to
the auxiliary "have" before, costing the line a foot (read tetrameter); now "theirs" (phr 1)
takes the beat and the line reads iambic **pentameter**.  Comma caesura restored
(`caesura.ts`): a comma is a ϕ break, not an ι, so the ι-only caesura test silently dropped
every comma caesura — re-added directly, restoring pre-caesural + caesural internal-rhyme.

---

## UDPipe PARSER SWAP — κ/ϕ/ι comparison (2026-06-22)

The dependency parser was swapped from en-parse (FinNLP) to **UDPipe** (English GUM
2.5, pure-WASM via `udpipe-node`). See `UDPIPE_MIGRATION.md`. Bracketing below is
the live `analyzeText` hierarchy (order-preserving render via
`scripts/benchmark-udpipe.mjs`); **UD** = this swap, **NEW′** = the prior en-parse
dependency-driven column above.

| # | Expert (ϕ units) | UDPipe | ϕ verdict vs expert |
|---|---|---|---|
| 1 | `{it was thought of}{constantly}` | `{[it][was][thought]}{[of constantly]}` | ~ "of" strays right (defect C); ϕ split otherwise right; κ over-split |
| 2 | `{this is the cat}{that caught the rat}{that stole the cheese}` | `{[this][is][the cat]}{[that caught]}{[the rat]}{[that stole]}{[the cheese]}` | ~ relative-clause ϕ present but object NPs split off |
| 3 | `{In Pakistan},{Tuesday},{which is a weekday},{is a holiday}` | `<{in pakistan}><{tuesday}><{which is a weekday}><{is a holiday}>` | ✓ **ι at commas — closer to expert than NEW′** |
| 4 | `{Given the chance}{rabbits}{reproduce quickly}` | `{given the chance}<ι>{rabbits reproduce quickly}` | ✗ subject\|predicate split lost (NEW′ had it exact) |
| 5 | `{More than fifteen carpenters}{are working}{in the house}` | `{more}{than fifteen}{carpenters}{are working}{in the house}` | ✗ subject NP fragmented |
| 6 | `[Please][leave them][alone]` | `{[please leave them][alone]}` | ~ (as before) |
| 7 | `{the curfew}{tolls}{the knell}{of parting day}` | `{the curfew}{tolls}{the knell}{of parting day}` | ✓ **4 ϕ — recovers what NEW′ regressed to 1 ϕ** |
| 8 | `{WHEN you}{are old}{and gray}{and full}{of sleep}` | `{when you are old}{and gray}{and full}{of sleep}` | ~ coordinate ϕ right; when-you\|are-old merged |
| 9 | `{Nature's first green}{is gold}` | `{nature 's}{first green}{is gold}` | ~ `'s` preserved; subject NP split (parse-bound: green→amod) |
| 10 | `{The invisible worm}{that flies in the night}{in the howling storm}` | `{the invisible worm}{that flies}{in the night}{in the howling storm}` | ✓ ϕ matches expert; κ over-split inside |
| 11 | `{absent-minded professor}{has been avidly reading}{the latest biography}{of Marcel Proust}` | `{the absent-minded professor}{has been avidly reading}{the latest biography}{of marcel proust}` | ✓ **all 4 units exact — fixes NEW′ clause-flatten + name-tear** |

**Net:** at the ϕ level UDPipe is **comparable-to-better** than en-parse — it *fixes*
#11 (clause flattening + name tear) and #7 (noun-pile regression), and #3 gains the
ι-at-comma reading; #10 holds exact. The parse-bound ϕ misses (#4 subject|predicate,
#5 subject-NP, #1 stranded "of", #9 green→amod) remain parse-quality issues.

**New regression — κ (clitic-group) over-segmentation.** Pre-nominal modifier runs
split into one κ per word (`[the][invisible][worm]`) where the expert groups by
adjacency (`[the invisible][worm]`). Cause: the κ-grouper attaches a function word
to its dependency *head* (UDPipe `the`→det→`worm`, skipping the intervening adjective)
instead of encliticising onto the *adjacent* content word. **Next fix:** make clitic
grouping adjacency-aware (a determiner/clitic leans onto the nearest following content
word, not its distant head) — `phonological.ts` clitic grouping; held out of the swap
because it touches the κ layer that 88/102 tests pass against.
