#!/usr/bin/env node
// Calliope TS — web app server + MCP (Model Context Protocol) server.
// Serves the static front-end from webapp/public and exposes the full analysis
// pipeline as structured JSON at POST /api/analyze, plus MCP endpoints:
//   - POST/GET/DELETE /mcp   (Streamable HTTP, modern spec, stateless)
//   - GET /sse + POST /messages (SSE, legacy compat for Claude Desktop / Cursor)
//   - GET /api/mcp/info      (discovery)
// All the information the CLI's Reading and Detailed views print (plus the raw
// UDPipe / nounsing-pro substrates) is serialized here so the browser and LLM
// agents can render it interactively.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { analyzeReadingDocument } from '../dist/index.js';
import { analyzeReadingDocumentClio } from '../dist/clio/pipeline.js';
import { createCalliopeEngine } from '../dist/calliope/engine.js';
import { isPunctuation } from '../dist/parser.js';
import { syllabifyWord, syllableVowelLengths, vowelLengthOf } from '../dist/phonological.js';
import { computeCaesurae } from '../dist/caesura.js';
import { buildFabbHalleGridsForPoem } from '../dist/fabbhalle.js';
import { computeBoundaries } from '../dist/calliope/boundaries.js';
import { summarizePoem, analyzePhonopoetics } from '../dist/rhyme.js';
import * as nounsing from 'nounsing-pro';
import {
  setInterfaceOptions, GRAMMARS, GRAMMAR_NAMES, CONSTRAINT_TABLE,
  lastPhiStructure, renderProsodicTree, maxPhiDepth,
} from '../dist/interface/index.js';
import {
  setNeuralProsodyOptions, prosodyModelStatus, adviseProsody, renderContour,
} from '../dist/prosody-neural/index.js';

// MCP SDK
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4321);

// ─── Serialization helpers ──────────────────────────────────────────────

const normWordForm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

/** Non-punctuation, syllable-bearing words across a line's results, in order. */
function collectLineWords(ln) {
  const ws = [];
  for (const res of ln.results) {
    for (const w of res.sentence.words) {
      if (!isPunctuation(w.lexicalClass) && w.syllables.length > 0) ws.push(w);
    }
  }
  return ws;
}

/** Orthographic syllable chunks for a token, aligned to its word's syllables. */
function chunkToken(tokenText, word) {
  const sylCount = Math.max(1, word.syllables.length);
  const chunks = syllabifyWord(
    tokenText, sylCount, syllableVowelLengths(word.syllables),
    word.morphSuffix, word.morphPrefix,
  );
  if (chunks.join('') === tokenText) {
    return chunks.map((c, i) => ({ text: c, si: Math.min(i, word.syllables.length - 1) }));
  }
  const lens = chunks.map(c => c.length);
  const out = [];
  let ci = 0, consumed = 0;
  const push = (ch, si) => {
    const last = out[out.length - 1];
    if (last && last.si === si) last.text += ch;
    else out.push({ text: ch, si });
  };
  for (const ch of tokenText) {
    if (ch === '-') { push(ch, Math.min(ci, word.syllables.length - 1)); continue; }
    while (ci < lens.length - 1 && consumed >= lens[ci]) { ci++; consumed = 0; }
    push(ch, Math.min(ci, word.syllables.length - 1));
    consumed++;
  }
  return out;
}

/** Structural port of projectStressOntoLine(): the verbatim raw line split into segments. */
function buildSegments(rawLine, words) {
  const tokenRe = /[A-Za-z\u00C0-\u024F]+(?:['’\-][A-Za-z\u00C0-\u024F]+)*/g;
  const segments = [];
  let cursor = 0, wi = 0, m;
  const pushGap = (text) => { if (text) segments.push({ t: 'gap', text }); };
  while ((m = tokenRe.exec(rawLine)) !== null) {
    const start = m.index, end = start + m[0].length;
    pushGap(rawLine.slice(cursor, start));
    cursor = end;
    const token = m[0];
    const tokNorm = normWordForm(token);
    const matches = (w) => {
      if (!w) return false;
      const wn = normWordForm(w.word);
      return wn.length > 0 && (tokNorm === wn || tokNorm.startsWith(wn));
    };
    let matched = -1;
    if (matches(words[wi])) matched = wi;
    else {
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (matches(words[k])) { matched = k; break; }
      }
    }
    if (matched >= 0) {
      segments.push({ t: 'word', w: matched, chunks: chunkToken(token, words[matched]) });
      wi = matched + 1;
    } else {
      pushGap(token);
    }
  }
  pushGap(rawLine.slice(cursor));
  return segments;
}

/** Fine-grained syllable phonology derived from the ARPAbet transcription */
const ARPA_VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
const ARPA_DIPH = new Set(['AY', 'AW', 'OY', 'EY', 'OW']);
function sylPhonology(phonesStr) {
  const toks = String(phonesStr ?? '').replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
  const vIdx = toks.findIndex(t => ARPA_VOWEL.test(t));
  if (vIdx < 0) return null;
  const onsetN = vIdx;
  const codaN = toks.length - vIdx - 1;
  const vowel = toks[vIdx].replace(/\d/g, '');
  const isDiph = ARPA_DIPH.has(vowel);
  let long = isDiph;
  try { if (vowelLengthOf(phonesStr) === 'long') long = true; } catch { }
  const rime = codaN === 0 ? (long ? '-VV' : '-V')
    : long ? (codaN >= 2 ? '-TCC' : '-TC')
    : (codaN >= 2 ? '-LCC' : '-LC');
  return {
    onset: onsetN === 0 ? '0' : 'C'.repeat(Math.min(3, onsetN)),
    nucleus: isDiph ? 'diphthong' : 'monophthong',
    vlen: long ? 'long' : 'short',
    codaC: codaN,
    open: codaN === 0,
    rime,
  };
}
const SYL_POSITION = ['final', 'penult', 'antepenult', 'preantepenult'];

function serializeWord(w, idx, firstSyl) {
  const dep = w.dependency;
  const display = w.displayWord ?? w.word;
  const orth = new Array(w.syllables.length).fill('');
  try {
    for (const c of chunkToken(display, w)) orth[c.si] = (orth[c.si] ?? '') + c.text;
  } catch { }
  return {
    i: idx,
    text: w.displayWord ?? w.word,
    norm: w.word,
    pos: w.lexicalClass,
    isContent: !!w.isContent,
    phraseStress: w.phraseStress ?? 0,
    feats: w.featsMap && Object.keys(w.featsMap).length ? w.featsMap : null,
    canonicalRel: w.canonicalRel ?? null,
    dep: dep ? {
      rel: dep.dependentType,
      isRoot: dep.governorIndex === 0 || dep.dependentType === 'root',
      govWord: dep.governor?.word ?? null,
      govIndex: dep.governorIndex,
    } : null,
    flags: {
      person: !!w.isPersonName,
      place: !!w.isPlaceName,
      given: !!w.discourseGiven,
      coordGiven: !!w.coordinateGiven,
    },
    morph: (w.morphPrefix || w.morphSuffix)
      ? { prefix: w.morphPrefix ?? null, suffix: w.morphSuffix ?? null } : null,
    firstSyl,
    syls: w.syllables.map((s, si) => ({
      si,
      text: orth[si] || s.text,
      phones: s.phones,
      weight: s.weight ?? null,
      lex: s.lexicalStress ?? s.stress,
      boosted: s.stress,
      rel: s.relativeStress ?? 'w',
      extrametrical: s.extrametrical ?? null,
      pos: SYL_POSITION[Math.min(3, w.syllables.length - 1 - si)],
      ph: sylPhonology(s.phones),
    })),
  };
}

function hierarchyMembership(ius, words) {
  const loc = new Map();
  ius.forEach((iu, ii) =>
    iu.phonologicalPhrases.forEach((pp, pi) =>
      pp.cliticGroups.forEach((cg, ci) =>
        cg.tokens.forEach(t => loc.set(t, { iu: ii, pp: pi, cp: ci })))));
  return words.map(w => loc.get(w) ?? null);
}

function serializeHierarchy(ius, words) {
  const indexOf = new Map(words.map((w, i) => [w, i]));
  return ius.map(iu => ({
    pps: iu.phonologicalPhrases.map(pp => ({
      cps: pp.cliticGroups.map(cg =>
        cg.tokens.map(t => indexOf.get(t)).filter(i => i !== undefined)),
    })),
  }));
}

function serializeFeet(scansion, totalSyls) {
  const isSylChar = (ch) => 'xXwWnNmMsS'.includes(ch);
  const feet = [];
  let sylIdx = 0;
  for (const rawFoot of scansion.split('|')) {
    const cells = [];
    for (const ch of rawFoot) {
      if (ch === '-') { cells.push({ silent: true }); continue; }
      if (!isSylChar(ch)) continue;
      if (sylIdx < totalSyls) cells.push({ s: sylIdx++, mark: ch.toLowerCase() });
    }
    feet.push({ pattern: rawFoot, cells });
  }
  return feet;
}

function serializeDetail(d) {
  if (!d) return null;
  return {
    all: d.all,
    keyStresses: d.keyStresses,
    meter: d.meter,
    meterName: d.meterName,
    footCount: d.footCount,
    scansion: d.scansion,
    certainty: d.certainty,
    weightScore: d.weightScore,
    maxPossibleWeight: d.maxPossibleWeight,
    summary: d.summary,
    scoringMode: d.scoringMode ?? null,
    ...(d.prosodicCrosscheck ? { prosodicCrosscheck: d.prosodicCrosscheck } : {}),
    scoringDiagnostics: d.scoringDiagnostics ? {
      mode: d.scoringDiagnostics.mode,
      method: d.scoringDiagnostics.method,
      edgeEnding: d.scoringDiagnostics.edgeEnding ?? 'none',
      edgeTailPositions: d.scoringDiagnostics.edgeTailPositions ?? [],
      samples: (d.scoringDiagnostics.samples ?? []).map(sample => ({
        ...sample,
        boundaryStrength: Number(sample.boundaryStrength.toFixed(3)),
      })),
      candidates: (d.scoringDiagnostics.candidates ?? []).map(candidate => ({
        ...candidate,
        score: Number(candidate.score.toFixed(4)),
        fit: Number(candidate.fit.toFixed(4)),
        clean: Number(candidate.clean.toFixed(4)),
        unitEvidence: Number(candidate.unitEvidence.toFixed(4)),
        onset: Number(candidate.onset.toFixed(4)),
        prior: Number(candidate.prior.toFixed(4)),
      })),
    } : null,
    ranking: (d.ranking ?? []).map(r => ({ meter: r.meter, score: Number(r.score.toFixed(3)) })),
    standaloneMeter: d.standaloneMeter ?? null,
    consensusMeter: d.consensusMeter ?? null,
    rhythmNote: d.rhythmNote ?? null,
    metricalityNote: d.metricalityNote ?? null,
    formNote: d.formNote ?? null,
    rhyme: d.rhyme ? {
      endWord: d.rhyme.endWord,
      letter: d.rhyme.letter,
      type: d.rhyme.type ?? null,
      matchedLine: d.rhyme.matchedLine ?? null,
      notation: d.rhyme.notation ?? null,
      internal: (d.rhyme.internal ?? []).map(iw => ({
        word: iw.word, letter: iw.letter, type: iw.type ?? null,
      })),
    } : null,
  };
}

function serializeLine(ln) {
  const res = ln.results[0];
  if (!res) return { raw: ln.raw, parsed: false };

  const words = collectLineWords(ln);
  let firstSyl = 0;
  const serWords = words.map((w, i) => {
    const sw = serializeWord(w, i, firstSyl);
    firstSyl += w.syllables.length;
    return sw;
  });
  const totalSyls = firstSyl;

  const syllables = [];
  serWords.forEach(sw => sw.syls.forEach(s => syllables.push({
    w: sw.i, si: s.si, text: s.text, phones: s.phones, weight: s.weight,
    lex: s.lex, rel: s.rel,
  })));

  const ius = res.phonologicalHierarchy;
  const allWords = res.sentence.words;

  // The syntax→prosody interface module's winning prosodic TREE, when a grammar
  // other than `legacy` produced this line.  Null under `legacy`, which has no
  // tree to report — its φ layer is a flat partition by construction.
  let phiStructure = null;
  try {
    const st = lastPhiStructure(res.sentence);
    if (st) {
      phiStructure = {
        grammar: st.grammar.name,
        theory: st.grammar.theory,
        binarityUnit: st.grammar.binarityUnit,
        bracketing: renderProsodicTree(st.tree),
        depth: maxPhiDepth(st.tree),
        cost: st.cost,
        strata: st.grammar.strata,
        violations: Object.entries(st.violations)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => {
            const info = CONSTRAINT_TABLE.find(c => c.name === name);
            return {
              name, count,
              label: info?.label ?? name,
              family: info?.family ?? 'markedness',
              definition: info?.definition ?? '',
              source: info?.source ?? '',
            };
          }),
        syntax: st.syn
          .filter(x => x.kind !== 'word')
          .map(x => ({ kind: x.kind, start: x.start, end: x.end, rel: x.rel })),
      };
    }
  } catch { /* advisory display only — never break a scan over it */ }

  let boundaries = null;
  try {
    const b = computeBoundaries(allWords, ius);
    boundaries = {
      phi: b.phi.map(x => ({ strength: x.strength, syl: x.syllableIndex })),
      iota: b.iota.map(x => ({ strength: x.strength, syl: x.syllableIndex })),
    };
  } catch { }

  let caesurae = [];
  try {
    caesurae = [...computeCaesurae(allWords, ius, res.phonologicalScansion.scansion)]
      .map(([after, info]) => ({ after, kind: info.kind, strength: info.strength }));
  } catch { }

  const deps = serWords
    .filter(sw => sw.dep)
    .map(sw => {
      let govIdx = -1;
      try {
        const gov = sw.dep.isRoot ? null : words[sw.i].dependency?.governor;
        if (gov) govIdx = words.findIndex(w => w === gov);
      } catch {}
      return { from: sw.i, to: sw.dep.isRoot ? -1 : govIdx, rel: sw.dep.rel };
    });

  return {
    raw: ln.raw,
    ...(phiStructure ? { phiStructure } : {}),
    parsed: true,
    focusPrimacyMode: res.sentence.focusPrimacyMode ?? null,
    segments: buildSegments(ln.raw, words),
    words: serWords,
    syllables,
    hierarchy: serializeHierarchy(ius, words),
    unitOf: hierarchyMembership(ius, words),
    boundaries,
    caesurae,
    keyStresses: (res.keyStresses ?? []).map(k => ({
      unitType: k.unitType, pattern: k.pattern, weight: k.weight, positions: k.positions,
    })),
    feet: serializeFeet(res.phonologicalScansion.scansion, totalSyls),
    detail: serializeDetail(res.phonologicalScansion),
    scandroid: (() => {
      const sn = res.scandroidNative;
      if (!sn) return null;
      const serFoot = f => f ? {
        algorithm: f.algorithm, scanString: f.scanString, marksString: f.marksString,
        substitutions: f.substitutions, ok: f.ok, failReason: f.failReason ?? null,
      } : null;
      return {
        metronName: sn.metronName,
        lineLengthName: sn.lineLengthName,
        lineFeetSet: sn.lineFeetSet,
        verdict: serFoot(sn.verdict),
        corralTheWeird: serFoot(sn.corralTheWeird ?? null),
        maximizeTheNormal: serFoot(sn.maximizeTheNormal ?? null),
        promotions: sn.promotions,
      };
    })(),
    fabbHalle: null,
    deps,
  };
}

function attachFabbHalle(resultStanzas) {
  try {
    const lines = resultStanzas.flatMap(st => st.lines).filter(l => l.parsed);
    const allFhSyls = lines.map(line => {
      const perWord = new Map();
      line.syllables.forEach(s => perWord.set(s.w, (perWord.get(s.w) ?? 0) + 1));
      return line.syllables.map(s => {
        const poly = (perWord.get(s.w) ?? 1) > 1;
        const cliticMono = !poly && line.words[s.w] && !line.words[s.w].isContent;
        return { text: s.text, lex: cliticMono ? 0 : (s.lex ?? 0), poly };
      });
    });
    const poem = buildFabbHalleGridsForPoem(allFhSyls);
    if (!poem) return null;
    lines.forEach((line, i) => {
      const fh = poem.grids[i];
      const engineMeter = line.detail?.meter ?? null;
      const agrees = engineMeter
        ? (engineMeter.includes(poem.schema)
           || (poem.schema === 'loose' && /accentual|loose|dolnik|free/i.test(engineMeter)))
        : null;
      line.fabbHalle = fh ? {
        rule: fh.ruleLabel
          + ' · poem-discovered by grid construction'
          + (agrees === null ? '' : agrees ? ', agreeing with the engine' : ` (the engine read ${engineMeter})`),
        rows: fh.rows,
        maxima: fh.maxima, violations: fh.violations, metrical: fh.metrical,
        looseFeet: fh.looseFeet ?? null,
        schema: poem.schema,
      } : null;
    });
    return poem.schema;
  } catch { return null; }
}

function lineRunsOn(raw) {
  const t = raw.replace(/["'’”»)\]]+$/, '').trimEnd();
  if (!t) return false;
  return !/[.!?;:,—–…]$/.test(t);
}
function summariseEnjambment(stanzas) {
  const raws = stanzas.flatMap(st => st.lines.map(l => l.raw));
  if (raws.length < 2) return null;
  const interior = raws.slice(0, -1);
  const enjambed = [];
  interior.forEach((r, i) => { if (lineRunsOn(r)) enjambed.push(i + 1); });
  const n = interior.length, k = enjambed.length;
  if (k === 0) return 'end-stopped throughout';
  const where = k <= 6 ? ' (lines ' + enjambed.join(', ') + ')' : '';
  return k >= Math.ceil(n / 2)
    ? `predominantly enjambed — ${k} of ${n} line-ends run on${where}`
    : `mostly end-stopped — ${k} of ${n} line-ends enjambed${where}`;
}

function analyze(
  text,
  engine,
  prosody = 'wagner',
  useScandroid = true,
  scoringMode = 'current',
  prosodicCrosscheck = 'off',
  phiTheory = 'legacy',
  phiBinarity = null,
) {
  const t0 = Date.now();
  // Syntax→prosody interface grammar (src/interface). Set process-wide for the
  // duration of this analysis, then cleared — the same run-scoped-switch shape
  // the elision and peak-swap licences already use, so no engine signature
  // changes and a run that does not ask for it cannot be affected by it.
  const selectedPhi = GRAMMARS[phiTheory] ? phiTheory : 'legacy';
  setInterfaceOptions(selectedPhi === 'legacy'
    ? {}
    : { grammar: selectedPhi, ...(phiBinarity ? { binarityUnit: phiBinarity } : {}) });
  try {
    return analyzeInner(text, engine, prosody, useScandroid, scoringMode,
                        prosodicCrosscheck, selectedPhi, t0);
  } finally {
    setInterfaceOptions({});
  }
}

function analyzeInner(
  text, engine, prosody, useScandroid, scoringMode, prosodicCrosscheck,
  selectedPhi, t0,
) {
  const focusPrimacyMode = prosody === 'spe' ? 'spe' : 'wagner';
  const selectedScoringMode = scoringMode === 'mcaleese' ? 'mcaleese' : 'current';
  const selectedCrosscheck = prosodicCrosscheck === 'rerank'
    ? 'adaptive'
    : prosodicCrosscheck === 'advisory' || prosodicCrosscheck === 'adaptive'
      ? prosodicCrosscheck
      : 'off';
  const stanzas = engine === 'clio'
    ? analyzeReadingDocumentClio(text)
    : analyzeReadingDocument(
      text,
      createCalliopeEngine(focusPrimacyMode),
      useScandroid,
      selectedScoringMode,
      selectedCrosscheck,
    );

  const resultStanzas = stanzas.map(st => {
    const firstDetail = st.lines.flatMap(l => l.results)[0]?.phonologicalScansion;
    return {
      formNote: firstDetail?.formNote ?? null,
      lines: st.lines.map(serializeLine),
    };
  });
  const fabbHalleMeter = attachFabbHalle(resultStanzas);

  const grouped = stanzas.map(st => st.lines.flatMap(l => l.results));
  let synopsis = [];
  let phonopoetics = null;
  try { synopsis = summarizePoem(grouped); } catch { }
  try {
    const p = analyzePhonopoetics(grouped);
    phonopoetics = {
      endScheme: p.endScheme,
      end: p.end, caesural: p.caesural, head: p.head,
      alliteration: p.alliteration, acrostics: p.acrostics,
    };
  } catch { }

  return {
    engine: engine === 'clio' ? 'clio' : 'calliope',
    focusPrimacyMode: engine === 'clio' ? null : focusPrimacyMode,
    scoringMode: engine === 'clio' ? null : selectedScoringMode,
    phiTheory: engine === 'clio' ? null : selectedPhi,
    phiTheoryFamily: engine === 'clio' ? null : (GRAMMARS[selectedPhi]?.theory ?? null),
    ...(engine !== 'clio' && selectedCrosscheck !== 'off'
      ? { prosodicCrosscheck: selectedCrosscheck }
      : {}),
    elapsedMs: Date.now() - t0,
    stanzas: resultStanzas,
    synopsis,
    enjambment: summariseEnjambment(stanzas),
    phonopoetics,
    fabbHalleMeter,
  };
}

function wordDossier(raw) {
  const word = String(raw).toLowerCase().replace(/[^a-z'’\-]/g, '').replace(/’/g, "'");
  const first = (fn) => { try { const r = fn(word); return Array.isArray(r) ? r[0] ?? null : r ?? null; } catch { return null; } };
  const insetsRaw = first(nounsing.metricalInsets);
  const insets = insetsRaw
    ? Object.fromEntries(Object.entries(insetsRaw).filter(([, v]) => v?.length))
    : null;
  let rhymes = [];
  try { rhymes = nounsing.rhymes(word).slice(0, 18); } catch { }
  return {
    word,
    lexicon: first(nounsing.lexicon),
    phonemics: first(nounsing.phonemics),
    scansion: first(nounsing.scansion),
    weights: first(nounsing.weights),
    vowels: first(nounsing.vowels),
    vowelQualities: first(nounsing.vowelQualities),
    edges: first(nounsing.edges),
    onsetParse: first(nounsing.onsetParse),
    morphology: first(nounsing.morphology),
    suffixShift: first(nounsing.suffixShiftPotential),
    extrametricals: first(nounsing.extrametricals),
    rhymeProfile: first(nounsing.rhymeProfile),
    codaComplexity: first(nounsing.codaComplexity),
    insets,
    rhymes,
  };
}

// ─── MCP Server Factory ───────────────────────────────────────────────

const sseTransports = new Map(); // sessionId -> SSEServerTransport
const httpTransports = new Map(); // sessionId -> StreamableHTTPServerTransport + server instance

function createMcpServer() {
  const server = new McpServer({
    name: 'calliope-ts',
    version: '0.1.7',
  }, {
    capabilities: {
      tools: {},
    }
  });

  // Capabilities / help tool
  server.registerTool('get_capabilities', {
    title: 'Get Calliope TS Capabilities',
    description: 'Return high-level description of Calliope TS: engines, meters, rhyme types, syntax, rewrites, and example queries. Use to discover how to call other tools.',
    inputSchema: {},
  }, async () => {
    const caps = {
      name: 'calliope-ts',
      version: '0.1.7',
      description: 'Phonological poetry scansion & analysis suite in TypeScript. English + Russian, with Fabb-Halle grids, Scandroid, syntax, rhyme, rewrites.',
      engines: {
        calliope: 'Default faithful English engine (McAleese lineage, UDPipe, DepEdit, Nounsing Pro)',
        clio: 'Alternative fixed parse for comparison',
        russian: 'Russian poetry scansion (UDPipe SynTagRus + neural stress + dictionary, Koziev/Gasparov lineage)',
        auto: 'Auto-detect Cyrillic vs Latin, route to Russian or Calliope',
      },
      focus_primacy_modes: {
        wagner: 'Default Calliope mode: Wagner-style relational matching and prosodic subordination',
        spe: 'Halle/Chomsky mode: strict cyclic Compound + Nuclear Stress Rules (SPE numbering, 1 strongest)',
      },
      meter_scoring_modes: {
        current: 'Default gradient DP plus the established PP/IU right-edge bonus',
        mcaleese: 'Alternate McAleese-informed allocated PW/CP/PP/IU anchors and line-edge evidence over the same DP fits',
      },
      prosodic_crosscheck_modes: {
        off: 'Default: exact existing pipeline, no tableau report',
        advisory: 'Attach an independent Calliope-feature OT/HG tableau and exact Pareto-frontier report without changing the verdict',
        adaptive: 'Late arbitration when independent local and document grids agree and a low-repair Calliope realization clears held-out activation gates',
        rerank: 'Deprecated compatibility alias for adaptive arbitration',
      },
      meters: ['iambic', 'trochaic', 'anapestic', 'dactylic', 'amphibrachic', 'dolnik', 'accentual', 'free verse', 'loose iambic (Fabb-Halle)'],
      instruments: ['Scansion (full reading view)', 'Rhyme Forge (word dossiers)', 'Rewrites (Nounsing Pro transforms)', 'Syntax (UDPipe arcs)', 'Fabb-Halle bracketed grids (independent second opinion)', 'Scandroid (Hartman) second opinion'],
      tools: [
        { name: 'scan_poem', desc: 'Full poem scan for meter, rhyme, form, enjambment, phonopoetics' },
        { name: 'scan_line', desc: 'Deep single-line close reading' },
        { name: 'parse_syntax', desc: 'Dependency syntax via UDPipe' },
        { name: 'get_word_dossier', desc: 'Deep Nounsing Pro dossier for a word' },
        { name: 'find_rhymes', desc: 'Twenty-one rhyme types + POS/frequency/syllable/meter/stress filters' },
        { name: 'meter_match', desc: 'Find words matching stress pattern (e.g. 0101)' },
        { name: 'rewrite_text', desc: 'Stress/rhyme/phone-preserving rewrites' },
        { name: 'analyze_russian_poem', desc: 'Dedicated Russian pipeline' },
        { name: 'get_capabilities', desc: 'This help' },
      ],
      endpoints: {
        rest: {
          '/api/analyze': 'POST {text, engine, prosody, scoringMode, prosodicCrosscheck, useScandroid, phiTheory, phiBinarity} -> full JSON',
        '/api/interface': 'GET -> the syntax→prosody grammars and their constraint inventory',
        '/api/prosody-model': 'GET -> neural prosody wing status',
        '/api/prosody-contour': 'POST {text} -> pitch/energy contour per word',
          '/api/russian': 'POST {text} -> Russian',
          '/api/word?w=...': 'GET word dossier',
          '/api/meter?pattern=010': 'GET meter match',
          '/api/rewrite': 'POST {text, mode, ...} -> rewritten',
        },
        mcp: {
          streamableHttp: '/mcp (POST for JSON-RPC, GET for SSE notifications) - modern spec',
          sse: '/sse (GET establishes SSE, returns endpoint event)',
          messages: '/messages?sessionId=... (POST JSON-RPC for SSE transport)',
          info: '/api/mcp/info',
        }
      },
      example_queries: {
        scan_poem: { text: 'Shall I compare thee to a summer’s day?\nThou art more lovely and more temperate:', engine: 'auto', prosody: 'wagner', scoring_mode: 'current', prosodic_crosscheck: 'advisory', detail_level: 'summary' },
        scan_line: { text: 'Mary ate sweet ice cream.', engine: 'calliope', prosody: 'spe', scoring_mode: 'mcaleese', prosodic_crosscheck: 'off' },
        get_word_dossier: { word: 'summer', rhyme_by_syllable: 2 },
        find_rhymes: { word: 'day', rhyme_type: 'perfect', syllable_count: 1, limit: 20 },
        meter_match: { pattern: '0101010101', limit: 20 },
        rewrite_text: { text: 'Shall I compare thee to a summer’s day?', mode: 'stress', language: 'en', freq_threshold: 2.25 },
      },
      usage_for_agents: 'For remote OpenRouter / Claude / Cursor agents: point MCP client at https://<your-space>.hf.space/mcp (streamable HTTP) or https://<your-space>.hf.space/sse (SSE). No auth needed for public Spaces. Use scan_poem for poems/songs/stanzas/lines, parse_syntax for syntax, find_rhymes / meter_match for composition, rewrite_text for transforms.',
    };
    return { content: [{ type: 'text', text: JSON.stringify(caps, null, 2) }] };
  });

  // scan_poem
  server.registerTool('scan_poem', {
    title: 'Scan Poem / Verse / Stanza / Song',
    description: 'Full phonological scansion of a poem, song lyric, stanza, verse, or any multi-line text. Supports English and Russian (auto-detected). Returns meter, rhyme scheme, form, synopsis, per-line tags, Fabb-Halle independent grids, Scandroid second opinion, enjambment, phonopoetics. Use detail_level summary for LLM-friendly compact output, full for exhaustive syllable/word data.',
    inputSchema: {
      text: z.string().min(1).max(10000).describe('Poem text, single line to full poem. Newlines and blank lines delimit lines and stanzas. Up to 200 non-empty lines, 10k chars.'),
      engine: z.enum(['auto', 'calliope', 'clio', 'russian']).optional().default('auto').describe('Engine: auto detects Cyrillic vs Latin, calliope default English, clio alternative, russian forces Russian.'),
      prosody: z.enum(['wagner', 'spe']).optional().default('wagner').describe('Calliope Focus Primacy mode: wagner=relational matching/subordination (default); spe=strict Halle/Chomsky cyclic Compound + Nuclear Stress Rules. Ignored by Clio/Russian.'),
      scoring_mode: z.enum(['current', 'mcaleese']).optional().default('current').describe('English Calliope meter scorer: current=default gradient/edge scorer; mcaleese=alternate allocated PW/CP/PP/IU anchor and edge-treatment scorer. Ignored by Clio/Russian.'),
      prosodic_crosscheck: z.enum(['off', 'advisory', 'adaptive', 'rerank']).optional().default('off').describe('Late Calliope-native alternating-position OT/HG tableau: off=default exact compatibility; advisory=diagnostics only; adaptive=held-out-calibrated local-plus-document arbitration; rerank=legacy alias. Ignored by Clio/Russian.'),
      use_scandroid: z.boolean().optional().default(true).describe('Include Hartman Scandroid as an independent second opinion. Calliope only; disabling saves work.'),
      detail_level: z.enum(['summary', 'full']).optional().default('summary').describe('summary=compact LLM-friendly (meter, rhyme, synopsis, per-line). full=exhaustive JSON with syllables, stress, deps, feet, hierarchy.'),
    }
  }, async ({ text, engine, prosody, scoring_mode, prosodic_crosscheck, use_scandroid, detail_level }) => {
    try {
      const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const lat = (text.match(/[A-Za-z]/g) || []).length;
      const isRu = cyr > lat && cyr > 0;
      const eng = engine ?? 'auto';
      let result;
      if (eng === 'russian' || (eng === 'auto' && isRu)) {
        const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
        const t0 = Date.now();
        const ru = await analyzeRussianPoem(text);
        result = { engine: 'russian', elapsedMs: Date.now() - t0, ...ru };
      } else {
        const useEng = eng === 'auto' ? 'calliope' : eng;
        result = analyze(text, useEng, prosody, use_scandroid, scoring_mode, prosodic_crosscheck);
      }
      if (detail_level === 'full') {
        const str = JSON.stringify(result, null, 2);
        if (str.length > 200000) {
          return { content: [{ type: 'text', text: str.slice(0, 200000) + '\n...[truncated at 200k, request summary or split poem]' }] };
        }
        return { content: [{ type: 'text', text: str }] };
      }
      // summary
      const compact = {
        engine: result.engine,
        focusPrimacyMode: result.focusPrimacyMode ?? null,
        scoringMode: result.scoringMode ?? null,
        ...(result.prosodicCrosscheck ? { prosodicCrosscheck: result.prosodicCrosscheck } : {}),
        elapsedMs: result.elapsedMs,
        meter_overall: result.meter ?? result.meterRu ?? result.meter?.meterRu ?? null,
        score: result.score ?? null,
        rhymeScheme_overall: result.rhymeScheme ?? result.phonopoetics?.endScheme ?? null,
        synopsis: result.synopsis ?? null,
        enjambment: result.enjambment ?? null,
        fabbHalleMeter: result.fabbHalleMeter ?? null,
        formNote: result.stanzas?.[0]?.formNote ?? null,
        stanzas: (result.stanzas || []).map((st, si) => ({
          index: si,
          formNote: st.formNote ?? null,
          lines: (st.lines || []).map(l => ({
            raw: l.raw,
            meter: l.meterRu ?? l.detail?.meter ?? null,
            meterEn: l.meterEn ?? l.detail?.meterName ?? null,
            meterCertainty: l.detail?.certainty ?? null,
            scoringMode: l.detail?.scoringMode ?? null,
            ...(l.detail?.prosodicCrosscheck ? { prosodicCrosscheck: {
              mode: l.detail.prosodicCrosscheck.mode,
              status: l.detail.prosodicCrosscheck.status,
              reason: l.detail.prosodicCrosscheck.reason,
              applied: l.detail.prosodicCrosscheck.applied,
              independentMeter: l.detail.prosodicCrosscheck.independentMeter ?? null,
              independentConfidence: l.detail.prosodicCrosscheck.independentConfidence ?? null,
              documentMeter: l.detail.prosodicCrosscheck.documentMeter ?? null,
              documentConfidence: l.detail.prosodicCrosscheck.documentConfidence ?? null,
              documentVotes: l.detail.prosodicCrosscheck.documentVotes ?? null,
              documentEvaluatedLines: l.detail.prosodicCrosscheck.documentEvaluatedLines ?? null,
              documentVoteShare: l.detail.prosodicCrosscheck.documentVoteShare ?? null,
              documentVoteMargin: l.detail.prosodicCrosscheck.documentVoteMargin ?? null,
              recommendedMeter: l.detail.prosodicCrosscheck.recommendedMeter ?? null,
              candidateCount: l.detail.prosodicCrosscheck.candidateCount,
              frontierSize: l.detail.prosodicCrosscheck.frontierSize,
            } } : {}),
            summary: l.detail?.summary ?? l.note ?? null,
            scansion: l.detail?.scansion ?? l.scansion ?? null,
            syllableCount: l.syllableCount ?? l.syllables?.length ?? null,
            rhyme: l.rhyme ?? l.detail?.rhyme ?? null,
            rhymeForm: l.rhyme ? `${l.rhyme.letter ?? '-'}${l.rhyme.type ? `(${l.rhyme.type})` : ''}` : null,
            fabbHalle: l.fabbHalle ? { rule: l.fabbHalle.rule, metrical: l.fabbHalle.metrical, violations: l.fabbHalle.violations?.length ?? 0, maxima: l.fabbHalle.maxima } : null,
            scandroid: l.scandroid ? { metron: l.scandroid.metronName, lineLen: l.scandroid.lineLengthName, scan: l.scandroid.verdict?.scanString } : null,
          }))
        }))
      };
      return { content: [{ type: 'text', text: JSON.stringify(compact, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `scan_poem failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // scan_line
  server.registerTool('scan_line', {
    title: 'Scan Single Verse Line (Deep)',
    description: 'Close reading of a single verse line: syllable-by-syllable stress (lexical, phrase, relative), weight, POS, feats, dependency, feet, caesurae, prosodic hierarchy (IU/PP/CP), Scandroid second opinion, Fabb-Halle grid. Best for line-level analysis.',
    inputSchema: {
      text: z.string().min(1).max(1000).describe('Single verse line text'),
      engine: z.enum(['auto', 'calliope', 'clio', 'russian']).optional().default('auto').describe('Engine selection'),
      prosody: z.enum(['wagner', 'spe']).optional().default('wagner').describe('Calliope Focus Primacy mode; ignored by Clio/Russian'),
      scoring_mode: z.enum(['current', 'mcaleese']).optional().default('current').describe('Calliope English meter-scoring mode; ignored by Clio/Russian'),
      prosodic_crosscheck: z.enum(['off', 'advisory', 'adaptive', 'rerank']).optional().default('off').describe('Independent late tableau mode; adaptive may apply held-out-calibrated local-plus-document arbitration; rerank is a legacy alias'),
      use_scandroid: z.boolean().optional().default(true).describe('Include Hartman Scandroid comparison (Calliope only)'),
    }
  }, async ({ text, engine, prosody, scoring_mode, prosodic_crosscheck, use_scandroid }) => {
    try {
      const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const lat = (text.match(/[A-Za-z]/g) || []).length;
      const isRu = cyr > lat && cyr > 0;
      const eng = engine ?? 'auto';
      if (eng === 'russian' || (eng === 'auto' && isRu)) {
        const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
        const ru = await analyzeRussianPoem(text);
        return { content: [{ type: 'text', text: JSON.stringify(ru, null, 2) }] };
      }
      const useEng = eng === 'auto' ? 'calliope' : eng;
      const res = analyze(text, useEng, prosody, use_scandroid, scoring_mode, prosodic_crosscheck);
      const firstLine = res.stanzas?.[0]?.lines?.[0];
      if (!firstLine) return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      return { content: [{ type: 'text', text: JSON.stringify(firstLine, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `scan_line failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // parse_syntax
  server.registerTool('parse_syntax', {
    title: 'Parse Syntax (UDPipe + DepEdit)',
    description: 'Parse syntax via UDPipe (English: SynTagRus for Russian auto-route) with DepEdit-TS repairs. Returns tokens with UPOS, features, dependency relations, governors, and prosodic hierarchy IU.PP.CP. Works for poem, stanza, verse, or single line. Language auto-detected.',
    inputSchema: {
      text: z.string().min(1).max(10000).describe('Text to parse (poem, stanza, line, sentence)'),
      engine: z.enum(['auto', 'calliope', 'clio', 'russian']).optional().default('auto').describe('Engine, auto detects Russian'),
      prosody: z.enum(['wagner', 'spe']).optional().default('wagner').describe('Calliope Focus Primacy mode; ignored by Clio/Russian'),
      fuse_lines: z.boolean().optional().default(false).describe('Replace line breaks with spaces and parse the input as one continuous unit'),
    }
  }, async ({ text, engine, prosody, fuse_lines }) => {
    try {
      const parseText = fuse_lines ? text.replace(/\s*\n+\s*/g, ' ') : text;
      const cyr = (parseText.match(/[А-Яа-яЁё]/g) || []).length;
      const lat = (parseText.match(/[A-Za-z]/g) || []).length;
      const isRu = cyr > lat && cyr > 0;
      const eng = engine ?? 'auto';
      if (eng === 'russian' || (eng === 'auto' && isRu)) {
        const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
        const ru = await analyzeRussianPoem(parseText);
        // Extract deps from ru stanzas
        const deps = (ru.stanzas || []).map((st, si) => ({
          stanza: si,
          lines: (st.lines || []).map(l => ({
            raw: l.raw,
            words: (l.words || []).map(w => ({
              text: w.form ?? w.text,
              lemma: w.lemma,
              upos: w.upos,
              feats: w.feats,
              deprel: w.deprel ?? w.dep?.rel,
              head: w.head,
              syllables: w.syllables,
            }))
          }))
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ engine: 'russian', deps }, null, 2) }] };
      }
      const useEng = eng === 'auto' ? 'calliope' : eng;
      const res = analyze(parseText, useEng, prosody, false);
      const syntax = res.stanzas.map((st, si) => ({
        stanza: si,
        formNote: st.formNote,
        lines: st.lines.map(l => ({
          raw: l.raw,
          words: l.words.map(w => ({
            text: w.text,
            norm: w.norm,
            pos: w.pos,
            isContent: w.isContent,
            feats: w.feats,
            dep: w.dep,
            flags: w.flags,
            firstSyl: w.firstSyl,
          })),
          deps: l.deps,
          hierarchy: l.hierarchy,
          boundaries: l.boundaries,
          caesurae: l.caesurae,
        }))
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ engine: useEng, focusPrimacyMode: res.focusPrimacyMode, fuse_lines, syntax }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `parse_syntax failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // get_word_dossier
  server.registerTool('get_word_dossier', {
    title: 'Get Word Dossier (Nounsing Pro)',
    description: 'Deep phonological, morphological, and metrical dossier for a single English word via Nounsing Pro augmented CMU lexicon: phones, syllabification, stress contour, weight pattern (H/L), rhyme profile, onset/coda geometry, morphology, lexical frequency, metrical insets, perfect rhymes. For Russian, use scan_line or analyze_russian_poem.',
    inputSchema: {
      word: z.string().min(1).max(100).describe('English word to look up'),
      rhyme_by_syllable: z.number().int().min(1).max(8).optional().describe('Optional filter: return rhymes with exactly N syllables (1-8)'),
    }
  }, async ({ word, rhyme_by_syllable }) => {
    try {
      const dossier = wordDossier(word);
      if (rhyme_by_syllable) {
        try { dossier.rhymesBySyll = nounsing.rhymeBySyllables(dossier.word, rhyme_by_syllable).slice(0, 60); }
        catch { dossier.rhymesBySyll = []; }
      }
      return { content: [{ type: 'text', text: JSON.stringify(dossier, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `get_word_dossier failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // find_rhymes
  server.registerTool('find_rhymes', {
    title: 'Find Rhymes',
    description: 'Find one of Nounsing Pro’s documented rhyme types with optional pronunciation, POS, frequency, syllable, poetic-foot, and stress-contour filters.',
    inputSchema: {
      word: z.string().min(1).max(100).describe('Word to rhyme'),
      rhyme_type: z.enum(['perfect', 'family', 'slant', 'masculine', 'feminine', 'dactylic', 'eye', 'rich', 'assonant', 'consonant', 'augmented', 'diminished', 'syllabic', 'light', 'wrenched', 'grammatical', 'trailing', 'apocopated', 'unstressed', 'mosaic', 'identical']).optional().default('perfect').describe('Rhyme taxonomy to search; default perfect'),
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Max results, default 20, max 100'),
      syllable_count: z.number().int().min(1).max(8).optional().describe('Filter rhymes to exact syllable count'),
      phones: z.string().max(200).optional().describe('Optional ARPAbet pronunciation override for the source word'),
      pos_precision: z.number().int().min(0).max(3).optional().default(0).describe('Part-of-speech fidelity: 0 off, 1 first tag letter, 2 first two letters, 3 exact Penn tag'),
      freq_threshold: z.number().min(0).max(10).optional().default(0).describe('Minimum Zipf frequency for candidates'),
      poetic_fit: z.enum(['iamb', 'trochee', 'spondee', 'pyrrhic', 'dactyl', 'anapest', 'amphibrach', 'bacchic', 'antibacchic', 'cretic', 'choriamb', 'antispast', 'first paeon', 'second paeon', 'third paeon', 'fourth paeon']).optional().describe('Require candidates to contain this poetic foot'),
      stress_pattern: z.string().regex(/^[012]+$/).max(20).optional().describe('Require this exact lexical stress contour: 0 unstressed, 1 primary, 2 secondary'),
    }
  }, async ({ word, rhyme_type, limit, syllable_count, phones, pos_precision, freq_threshold, poetic_fit, stress_pattern }) => {
    try {
      const w = String(word).toLowerCase().replace(/[^a-z'’\-]/g, '').replace(/’/g, "'");
      let rhymes = [];
      try {
        rhymes = nounsing.getRhymes(w, rhyme_type ?? 'perfect', {
          phones,
          posPrecision: pos_precision ?? 0,
          freqThreshold: freq_threshold ?? 0,
          syllables: syllable_count,
          poeticFit: poetic_fit,
          stressPattern: stress_pattern,
        });
      } catch { rhymes = []; }
      const total = rhymes.length;
      const slice = rhymes.slice(0, limit ?? 20);
      return { content: [{ type: 'text', text: JSON.stringify({ word: w, rhyme_type, total, filters: { syllable_count: syllable_count ?? null, pos_precision, freq_threshold, poetic_fit: poetic_fit ?? null, stress_pattern: stress_pattern ?? null }, rhymes: slice }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `find_rhymes failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // meter_match
  server.registerTool('meter_match', {
    title: 'Meter Match (Find Words by Stress Pattern)',
    description: 'Given a lexical stress contour (0 unstressed, 1 primary, 2 secondary), return English words carrying exactly that pattern. Examples: 01=iamb, 010=amphibrach, 100=dactyl.',
    inputSchema: {
      pattern: z.string().regex(/^[012]+$/).max(20).describe('Stress pattern, e.g. 010. Digits: 0=unstressed, 1=primary, 2=secondary.'),
      limit: z.number().int().min(1).max(200).optional().default(72).describe('Max words to return, default 72'),
    }
  }, async ({ pattern, limit }) => {
    try {
      const pat = String(pattern);
      if (!/^[012]+$/.test(pat)) throw new Error('Pattern must contain only 0/1/2');
      let words = [];
      try { words = nounsing.meterMatch(pat); } catch { words = []; }
      // deterministic shuffle-free sample: take first N sorted? keep random sample but stable? For MCP we return first 72 unsorted to be deterministic-ish
      const total = words.length;
      const out = words.slice(0, limit ?? 72);
      return { content: [{ type: 'text', text: JSON.stringify({ pattern: pat, total, words: out }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `meter_match failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // rewrite_text
  server.registerTool('rewrite_text', {
    title: 'Rewrite Text (Prosody-Preserving Transforms)',
    description: 'Creative rewrites preserving prosodic skeleton: stress (same stress contour), rhyme (same rhyme profile), or phones (sound-echo). Controls: pos_precision (0-3 POS fidelity), freq_threshold (0-4 word frequency filter), fuzzy_rhyme (bool), morph_ground (bool morphemic grounding), register_fidelity (0-4), dict_pos (bool use dictionary POS). Works for English and Russian (auto-detected). Max 4000 chars.',
    inputSchema: {
      text: z.string().min(1).max(4000).describe('Source text to transform (poem, line, etc.)'),
      mode: z.enum(['stress', 'rhyme', 'phones']).optional().default('phones').describe('Rewrite mode: stress=keep stress, rhyme=keep rhyme, phones=sound echo'),
      language: z.enum(['auto', 'en', 'ru']).optional().default('auto').describe('Language routing: auto detects script, en forces English, ru forces Russian'),
      pos_precision: z.number().int().min(0).max(3).optional().default(1).describe('POS precision 0-3, higher=stricter'),
      freq_threshold: z.number().min(0).max(4).optional().default(0).describe('Frequency threshold 0-4 (fractional values allowed), higher=common words only'),
      fuzzy_rhyme: z.boolean().optional().default(false).describe('Allow fuzzy rhyme tiers; valid only in rhyme mode'),
      morph_ground: z.boolean().optional().default(false).describe('Enable morphemic grounding (English only)'),
      register_fidelity: z.number().min(0).max(4).optional().default(0).describe('Register fidelity 0-4 (English only)'),
      dict_pos: z.boolean().optional().default(false).describe('Use dictionary POS instead of contextual parsing (English only)'),
    }
  }, async ({ text, mode, language, pos_precision, freq_threshold, fuzzy_rhyme, morph_ground, register_fidelity, dict_pos }) => {
    try {
      const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const lat = (text.match(/[A-Za-z]/g) || []).length;
      const pos = Math.max(0, Math.min(3, Number(pos_precision ?? 1)));
      const freq = Math.max(0, Math.min(4, Number(freq_threshold ?? 0)));
      const fuzzy = Boolean(fuzzy_rhyme);
      if (fuzzy && mode !== 'rhyme') throw new Error('fuzzy_rhyme is only valid when mode="rhyme"');
      const useRussian = language === 'ru' || (language !== 'en' && cyr > lat && cyr > 0);
      if (useRussian && (morph_ground || Number(register_fidelity ?? 0) > 0 || dict_pos)) {
        throw new Error('morph_ground, register_fidelity, and dict_pos are English-only options');
      }
      let output;
      if (useRussian) {
        const { rewriteRussianText } = await import('../dist/russian/rewrite.js');
        const ruMode = mode === 'stress' || mode === 'rhyme' || mode === 'phones' ? mode : 'phones';
        output = await rewriteRussianText(text, ruMode, pos, freq, fuzzy);
      } else {
        const { rewriteEnglishText } = await import('../dist/rewriteEn.js');
        const enMode = mode === 'stress' || mode === 'rhyme' || mode === 'phones' ? mode : 'phones';
        output = rewriteEnglishText(text, enMode, pos, freq, { fuzzyRhyme: fuzzy, morphGround: Boolean(morph_ground), registerFidelity: Math.max(0, Math.min(4, Number(register_fidelity ?? 0))), dictPos: Boolean(dict_pos) });
      }
      return { content: [{ type: 'text', text: JSON.stringify({ input: text, mode, language: useRussian ? 'ru' : 'en', output }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `rewrite_text failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  // analyze_russian_poem
  server.registerTool('analyze_russian_poem', {
    title: 'Analyze Russian Poem (Dedicated Pipeline)',
    description: 'Dedicated Russian scansion via Rupo+UDPipe+neural accent model: returns canonical meter (ямб, хорей, дактиль, амфибрахий, анапест, dolnik), technicality scores per stanza, rhyme scheme per block (AABB, ABAB, etc.), per-line stress variants, phonetic clausulae, yofication, and Fabb-Halle grids with polysyllabic maxima mode.',
    inputSchema: {
      text: z.string().min(1).max(10000).describe('Russian poem text, up to 200 lines'),
      detail_level: z.enum(['summary', 'full']).optional().default('summary').describe('summary or full'),
    }
  }, async ({ text, detail_level }) => {
    try {
      const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
      const t0 = Date.now();
      const ru = await analyzeRussianPoem(text);
      const result = { engine: 'russian', elapsedMs: Date.now() - t0, ...ru };
      if (detail_level === 'full') {
        const str = JSON.stringify(result, null, 2);
        if (str.length > 200000) return { content: [{ type: 'text', text: str.slice(0, 200000) + '\n...[truncated]' }] };
        return { content: [{ type: 'text', text: str }] };
      }
      const compact = {
        engine: 'russian',
        elapsedMs: result.elapsedMs,
        meter: result.meter,
        meterRu: result.meter?.meterRu ?? result.meter,
        score: result.score,
        rhymeScheme: result.rhymeScheme,
        stanzas: (result.stanzas || []).map((st, si) => ({
          index: si,
          lines: (st.lines || []).map(l => ({
            raw: l.raw,
            meter: l.meterRu,
            meterEn: l.meterEn,
            score: l.score,
            syllableCount: l.syllableCount,
            scansion: l.scansion,
            rhyme: l.rhyme,
            words: (l.words || []).map(w => ({ text: w.form ?? w.text, upos: w.upos, stressPos: w.stressPos, tier: w.syllables?.map(s => s.tier).join('') })),
            fabbHalle: l.fabbHalle ? { rule: l.fabbHalle.ruleLabel, metrical: l.fabbHalle.metrical, violations: l.fabbHalle.violations } : null,
          }))
        }))
      };
      return { content: [{ type: 'text', text: JSON.stringify(compact, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `analyze_russian_poem failed: ${err?.message ?? String(err)}` }], isError: true };
    }
  });

  return server;
}

// ─── HTTP plumbing ──────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  // Do not serve static for MCP endpoints - handled earlier
  if (urlPath.startsWith('/mcp') || urlPath === '/sse' || urlPath.startsWith('/messages')) {
    res.writeHead(404); res.end('Not static');
    return;
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 512 * 1024) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Last-Event-ID, Authorization, mcp-session-id, last-event-id, x-api-key, X-Api-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id');
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://x');
  const pathname = urlObj.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(200, { 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }

  // ── MCP: Streamable HTTP (modern spec) — supports BOTH stateful and stateless ──
  // Stateful: client does initialize -> gets mcp-session-id -> sends it back for tools/list, tools/call (OpenRouter, Claude)
  // Stateless: client sends tools/list or tools/call directly without session (curl tests) -> we handle one-off
  if (pathname === '/mcp') {
    if (req.method === 'GET') {
      const accept = req.headers.accept || '';
      if (!accept.includes('text/event-stream') && !accept.includes('application/json')) {
        setCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'calliope-ts MCP',
          endpoint: '/mcp',
          transports: { streamableHttp: '/mcp', sse: '/sse', messages: '/messages?sessionId=...' },
          usage: 'POST /mcp with JSON-RPC (MCP spec 2025-03-26). GET /mcp with Accept: text/event-stream opens SSE notifications stream. Supports both stateful (with mcp-session-id) and stateless modes.',
          clients: {
            claude_desktop: { mcpServers: { 'calliope-ts': { url: 'https://<your-space>.hf.space/mcp', transport: 'http' } } },
            openrouter: 'See https://openrouter.ai/docs/features/mcp - point at /mcp',
            cursor: { mcpServers: { 'calliope-ts': { url: 'https://<your-space>.hf.space/mcp' } } },
          }
        }, null, 2));
        return;
      }
    }
    try {
      setCorsHeaders(res);
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = (statusCode, headers) => {
        try { setCorsHeaders(res); } catch {}
        if (headers) return origWriteHead(statusCode, headers);
        return origWriteHead(statusCode);
      };

      const incomingSessionId = (req.headers['mcp-session-id'] || req.headers['Mcp-Session-Id'] || '').toString().trim();

      // If we have an existing session, reuse it (stateful flow)
      if (incomingSessionId && httpTransports.has(incomingSessionId)) {
        const entry = httpTransports.get(incomingSessionId);
        await entry.transport.handleRequest(req, res);
        return;
      }

      // For POST, we need to peek at the body to decide stateless vs stateful
      let parsedBody = undefined;
      let methodName = undefined;
      if (req.method === 'POST') {
        // Read body without consuming twice: we read now and pass parsedBody to SDK
        const bodyStr = await readBody(req);
        try {
          parsedBody = JSON.parse(bodyStr);
          // Handle batch (array) or single
          const first = Array.isArray(parsedBody) ? parsedBody[0] : parsedBody;
          methodName = first?.method;
        } catch {
          // invalid json will be handled by SDK
          try { parsedBody = JSON.parse(bodyStr); } catch { parsedBody = undefined; }
        }

        // If this is NOT an initialize and no sessionId, treat as stateless one-off (curl, simple clients)
        const isInit = methodName === 'initialize';
        if (!isInit && !incomingSessionId) {
          // Stateless handling: fresh transport per request, no session persistence
          const mcpServer = createMcpServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
            enableJsonResponse: false,
          });
          res.on('close', () => {
            try { transport.close(); } catch {}
            try { mcpServer.close(); } catch {}
          });
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
          return;
        }

        // Stateful path: initialize or request with sessionId that we haven't seen (new session)
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            httpTransports.set(sessionId, { transport, server: mcpServer, createdAt: Date.now() });
          },
          enableJsonResponse: false,
        });
        transport.onclose = () => {
          if (transport.sessionId) httpTransports.delete(transport.sessionId);
        };
        res.on('close', () => {
          if (!transport.sessionId) {
            try { transport.close(); } catch {}
            try { mcpServer.close(); } catch {}
          }
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, parsedBody);

        // Cleanup old sessions
        if (httpTransports.size > 100) {
          const now = Date.now();
          for (const [sid, entry] of httpTransports) {
            if (now - entry.createdAt > 30 * 60 * 1000) {
              try { entry.transport.close(); } catch {}
              try { entry.server.close(); } catch {}
              httpTransports.delete(sid);
            }
          }
        }
        return;
      }

      // For GET/DELETE without sessionId -> treat as stateless or return error via SDK
      // For GET with Accept: text/event-stream and no session, we allow stateless SSE stream (no notifications but valid)
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (incomingSessionId && !httpTransports.has(incomingSessionId)) {
          setCorsHeaders(res);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No session for ${incomingSessionId}` }));
          return;
        }
        // No session for GET/DELETE -> stateless: create one-off transport that will return 405 or empty stream as per SDK
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: false,
        });
        res.on('close', () => {
          try { transport.close(); } catch {}
          try { mcpServer.close(); } catch {}
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

    } catch (err) {
      console.error('mcp /mcp failed:', err);
      if (!res.headersSent) {
        setCorsHeaders(res);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MCP error: ' + (err?.message ?? String(err)) }));
      }
    }
    return;
  }

  // ── MCP: SSE (legacy, for Claude Desktop, Cursor, etc.) ────────────
  if (pathname === '/sse' && req.method === 'GET') {
    try {
      setCorsHeaders(res);
      const transport = new SSEServerTransport('/messages', res);
      sseTransports.set(transport.sessionId, transport);
      res.on('close', () => {
        sseTransports.delete(transport.sessionId);
      });
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    } catch (err) {
      console.error('sse /sse failed:', err);
      if (!res.headersSent) {
        setCorsHeaders(res);
        res.writeHead(500).end('SSE failed: ' + (err?.message ?? String(err)));
      }
    }
    return;
  }

  if (pathname === '/messages' && req.method === 'POST') {
    const sessionId = urlObj.searchParams.get('sessionId');
    if (!sessionId) {
      setCorsHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId query param' }));
      return;
    }
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      setCorsHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No transport for sessionId ${sessionId}` }));
      return;
    }
    try {
      setCorsHeaders(res);
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('sse /messages failed:', err);
      if (!res.headersSent) {
        res.writeHead(500).end('Message handling failed');
      }
    }
    return;
  }

  // ── REST: MCP info/discovery ───────────────────────────────────────
  if (pathname === '/api/mcp/info' && req.method === 'GET') {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'calliope-ts',
      version: '0.1.4',
      description: 'Poetry scansion & analysis MCP server + REST API',
      mcp: {
        streamableHttp: { endpoint: '/mcp', methods: ['POST', 'GET', 'DELETE'], spec: 'MCP 2025-03-26 Streamable HTTP, stateless', transport: 'http' },
        sse: { endpoint: '/sse', method: 'GET', description: 'Legacy SSE transport: GET /sse returns event: endpoint with sessionId, then POST /messages?sessionId=...' },
        clients: {
          claude_desktop: {
            config: {
              mcpServers: {
                'calliope-ts': {
                  command: 'npx',
                  args: ['-y', 'mcp-remote', 'https://<your-space>.hf.space/sse'],
                }
              }
            },
            alternative_http: {
              mcpServers: {
                'calliope-ts': {
                  url: 'https://<your-space>.hf.space/mcp',
                }
              }
            }
          },
          cursor: { mcpServers: { 'calliope-ts': { url: 'https://<your-space>.hf.space/mcp' } } },
          openrouter: {
            docs: 'https://openrouter.ai/docs/features/mcp',
            example: {
              model: 'anthropic/claude-3.5-sonnet',
              tools: [{ type: 'function', function: { name: 'scan_poem' } }],
              mcpServers: [{ name: 'calliope-ts', url: 'https://<your-space>.hf.space/mcp' }]
            }
          },
          generic: {
            typescript: "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'; const transport = new StreamableHTTPClientTransport(new URL('https://<space>.hf.space/mcp')); const client = new Client({name:'test',version:'1.0'}); await client.connect(transport);",
          }
        },
        tools: ['get_capabilities', 'scan_poem', 'scan_line', 'parse_syntax', 'get_word_dossier', 'find_rhymes', 'meter_match', 'rewrite_text', 'analyze_russian_poem'],
      },
      rest: {
        '/api/analyze': 'POST {text, engine, prosody, scoringMode, prosodicCrosscheck, useScandroid, phiTheory, phiBinarity}',
        '/api/interface': 'GET',
        '/api/prosody-model': 'GET',
        '/api/prosody-contour': 'POST {text}',
        '/api/russian': 'POST {text}',
        '/api/word': 'GET ?w=word&syll=2',
        '/api/meter': 'GET ?pattern=010',
        '/api/rewrite': 'POST {text, mode, posPrecision, freqThreshold, fuzzyRhyme, morphGround, registerFidelity, dictPos}',
        '/api/health': 'GET',
      }
    }, null, 2));
    return;
  }

  // ── REST: the syntax→prosody interface module ─────────────────────
  if (req.method === 'GET' && pathname === '/api/interface') {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      grammars: GRAMMAR_NAMES.map(n => ({
        name: n,
        theory: GRAMMARS[n].theory,
        binarityUnit: GRAMMARS[n].binarityUnit,
        description: GRAMMARS[n].description,
        strata: GRAMMARS[n].strata,
      })),
      constraints: CONSTRAINT_TABLE,
    }, null, 2));
    return;
  }

  // ── REST: the optional neural prosody wing ────────────────────────
  if (req.method === 'GET' && pathname === '/api/prosody-model') {
    setCorsHeaders(res);
    const st = prosodyModelStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...st,
      note: 'Renders a pitch/energy contour. Measured at CHANCE for phrase-boundary '
          + 'prediction (AUC 0.524 against a 7-annotator pause corpus), so it does '
          + 'not feed any verdict. See src/prosody-neural/advice.ts.',
    }, null, 2));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/prosody-contour') {
    try {
      setCorsHeaders(res);
      const body = await readBody(req);
      const { text } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No text supplied.' }));
        return;
      }
      const { readProsody } = await import('../dist/prosody-neural/index.js');
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 60);
      const out = [];
      for (const line of lines) {
        const r = await readProsody(line);
        if (!r) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Neural prosody wing unavailable — no model pack or no ONNX runtime.' }));
          return;
        }
        out.push({
          line,
          durationSeconds: r.durationSeconds,
          declination: r.contour.declination,
          f0Hz: Array.from(r.contour.f0Hz).map(v => Math.round(v)),
          rms: Array.from(r.contour.rms).map(v => Number(v.toFixed(3))),
          words: r.words.map(w => ({
            word: w.word, hz: Math.round(w.hz),
            f0Peak: Number(w.f0Peak.toFixed(3)),
            prominence: Number(w.prominence.toFixed(3)),
            frames: w.frames,
          })),
          gaps: r.gaps.map(g => ({
            after: g.after, strength: Number(g.strength.toFixed(3)),
            reset: Number(g.reset.toFixed(3)),
          })),
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lines: out }, null, 2));
    } catch (err) {
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Contour failed: ' + (err?.message ?? String(err)) }));
    }
    return;
  }

  // ── REST: existing API ─────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/analyze') {
    try {
      setCorsHeaders(res);
      const body = await readBody(req);
      const { text, engine, prosody, scoringMode, prosodicCrosscheck, useScandroid,
              phiTheory, phiBinarity } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No text supplied.' }));
        return;
      }
      if (prosody !== undefined && prosody !== 'wagner' && prosody !== 'spe') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prosody must be "wagner" or "spe".' }));
        return;
      }
      if (useScandroid !== undefined && typeof useScandroid !== 'boolean') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'useScandroid must be a boolean.' }));
        return;
      }
      if (scoringMode !== undefined && scoringMode !== 'current' && scoringMode !== 'mcaleese') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'scoringMode must be "current" or "mcaleese".' }));
        return;
      }
      if (prosodicCrosscheck !== undefined
        && prosodicCrosscheck !== 'off'
        && prosodicCrosscheck !== 'advisory'
        && prosodicCrosscheck !== 'adaptive'
        && prosodicCrosscheck !== 'rerank') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prosodicCrosscheck must be "off", "advisory", or "adaptive" (legacy alias: "rerank").' }));
        return;
      }
      if (phiTheory !== undefined && !GRAMMARS[phiTheory]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `phiTheory must be one of: ${GRAMMAR_NAMES.join(', ')}.` }));
        return;
      }
      if (phiBinarity !== undefined && phiBinarity !== null
          && phiBinarity !== 'omega' && phiBinarity !== 'lexical') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'phiBinarity must be "omega" or "lexical".' }));
        return;
      }
      const lineCount = text.split('\n').filter(l => l.trim()).length;
      if (lineCount > 200) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Poem too long — please keep it under 200 lines per request.' }));
        return;
      }
      const cyrillic = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const latin = (text.match(/[A-Za-z]/g) || []).length;
      if (cyrillic > latin && cyrillic > 0 && engine !== 'calliope' && engine !== 'clio') {
        try {
          const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
          const t0 = Date.now();
          const ruResult = await analyzeRussianPoem(text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ engine: 'russian', elapsedMs: Date.now() - t0, ...ruResult }));
          return;
        } catch (ruErr) {
          console.error('russian auto-detect failed:', ruErr);
        }
      }
      const result = analyze(
        text,
        engine,
        prosody,
        useScandroid !== false,
        scoringMode,
        prosodicCrosscheck,
        phiTheory ?? 'legacy',
        phiBinarity ?? null,
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('analyze failed:', err);
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Analysis failed: ' + (err?.message ?? String(err)) }));
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/word') {
    try {
      setCorsHeaders(res);
      const params = urlObj.searchParams;
      const w = params.get('w') ?? '';
      if (!w.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'no word' })); return; }
      const dossier = wordDossier(w);
      const syll = Number(params.get('syll'));
      if (syll >= 1 && syll <= 8) {
        try { dossier.rhymesBySyll = nounsing.rhymeBySyllables(dossier.word, syll).slice(0, 60); }
        catch { dossier.rhymesBySyll = []; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dossier));
    } catch (err) {
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/meter') {
    try {
      setCorsHeaders(res);
      const params = urlObj.searchParams;
      const pattern = (params.get('pattern') ?? '').replace(/[^012]/g, '');
      if (!pattern) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'pattern must be digits 0/1/2, e.g. 010' })); return; }
      let words = [];
      try { words = nounsing.meterMatch(pattern); } catch { }
      for (let i = words.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [words[i], words[j]] = [words[j], words[i]]; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pattern, total: words.length, words: words.slice(0, 72) }));
    } catch (err) {
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'POST' && pathname === '/api/rewrite') {
    try {
      setCorsHeaders(res);
      const body = JSON.parse(await readBody(req) || '{}');
      const text = String(body.text ?? '').slice(0, 4000);
      if (!text.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No text supplied.' })); return; }
      const pos = Math.max(0, Math.min(3, Number(body.posPrecision ?? 1)));
      const freq = Math.max(0, Math.min(4, Number(body.freqThreshold ?? 0)));
      const mode = body.mode;
      const fuzzy = Boolean(body.fuzzyRhyme);
      const morphGround = Boolean(body.morphGround);
      const registerFidelity = Math.max(0, Math.min(4, Number(body.registerFidelity ?? 0)));
      const dictPos = Boolean(body.dictPos);
      const cyr = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const lat = (text.match(/[A-Za-z]/g) || []).length;
      let output;
      if (cyr > lat && cyr > 0) {
        const { rewriteRussianText } = await import('../dist/russian/rewrite.js');
        const ruMode = mode === 'stress' || mode === 'rhyme' || mode === 'phones' ? mode : 'phones';
        output = await rewriteRussianText(text, ruMode, pos, freq, fuzzy);
      } else {
        const { rewriteEnglishText } = await import('../dist/rewriteEn.js');
        const enMode = mode === 'stress' || mode === 'rhyme' || mode === 'phones' ? mode : 'phones';
        output = rewriteEnglishText(text, enMode, pos, freq,
          { fuzzyRhyme: fuzzy, morphGround, registerFidelity, dictPos });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output }));
    } catch (err) {
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'POST' && pathname === '/api/russian') {
    try {
      setCorsHeaders(res);
      const body = await readBody(req);
      const { text } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No text supplied.' }));
        return;
      }
      const lineCount = text.split('\n').filter(l => l.trim()).length;
      if (lineCount > 200) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Poem too long — please keep it under 200 lines per request.' }));
        return;
      }
      const { analyzeRussianPoem } = await import('../dist/russian/engine.js');
      const t0 = Date.now();
      const result = await analyzeRussianPoem(text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ engine: 'russian', elapsedMs: Date.now() - t0, ...result }));
    } catch (err) {
      console.error('russian analyze failed:', err);
      setCorsHeaders(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Russian analysis failed: ' + (err?.message ?? String(err)) }));
    }
    return;
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mcp: { streamableHttp: '/mcp', sse: '/sse', info: '/api/mcp/info' } }));
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/api/mcp/info' || pathname === '/.well-known/mcp' || pathname === '/.well-known/mcp.json') {
      // already handled above for /api/mcp/info, but handle well-known as alias
      if (pathname !== '/api/mcp/info') {
        setCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ mcp_endpoint: '/mcp', sse_endpoint: '/sse', info: '/api/mcp/info' }));
        return;
      }
    }
    serveStatic(req, res);
    return;
  }
  setCorsHeaders(res);
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`Calliope web + MCP listening on http://localhost:${PORT}`);
  console.log(`  REST:  /api/analyze, /api/russian, /api/word, /api/meter, /api/rewrite, /api/health`);
  console.log(`  MCP Streamable HTTP: http://localhost:${PORT}/mcp (POST/GET/DELETE)`);
  console.log(`  MCP SSE (legacy):    http://localhost:${PORT}/sse (GET) + /messages?sessionId= (POST)`);
  console.log(`  MCP Info:            http://localhost:${PORT}/api/mcp/info`);
  try { analyze('Shall I compare thee to a summer’s day?', 'calliope'); console.log('pipeline warm'); }
  catch (e) { console.error('warm-up failed:', e); }
});
