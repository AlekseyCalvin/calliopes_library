/* Calliope web-report utilities.
 * Kept independent of the interactive renderer so exports and clipboard
 * reports can be tested without a browser or an active scansion server.
 */
(function installCalliopeReportUtils(root) {
  'use strict';

  // The two display themes, exactly as styles.css defines them.  The SVG export
  // is a picture OF the app, so it carries whichever theme the reader is
  // actually looking at — Terminal is the default, and the parchment Manuscript
  // palette is used only when the reader has explicitly chosen it in Settings.
  const THEMES = Object.freeze({
    terminal: Object.freeze({
      tiers: Object.freeze({ x: '#9a9a9a', w: '#56c7e8', n: '#46d17e', m: '#f5a63c', s: '#ff4b3e' }),
      ground: '#121315', frame: '#6e6236', title: '#e9e6dd', sub: '#94917f',
      body: '#e9e6dd', tag: '#94917f', measure: '#cac6ba', rule: '#6e6236',
      heading: '#ff6b5e', legend: '#94917f',
      // Single quotes inside the font stack: this string is interpolated into a
      // double-quoted XML attribute, so an inner double quote closes it early
      // and the SVG fails to parse ("attributes construct error").
      serif: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
    }),
    manuscript: Object.freeze({
      tiers: Object.freeze({ x: '#7f6d47', w: '#4e3e87', n: '#176644', m: '#9a5210', s: '#c1272d' }),
      ground: '#f4eddc', frame: '#9a7b35', title: '#211c18', sub: '#6e5c43',
      body: '#332d27', tag: '#8b7654', measure: '#695d50', rule: '#9a7b35',
      heading: '#7f2722', legend: '#5e5347',
      serif: 'Georgia, serif',
    }),
  });

  /** Resolve the export theme: an explicit `options.theme` wins; otherwise the
   *  live document's own class; otherwise Terminal, the app's default. */
  function themeOf(name) {
    if (name === 'manuscript' || name === 'terminal') return THEMES[name];
    if (typeof document !== 'undefined' && document.body
        && !document.body.classList.contains('theme-terminal')) {
      return THEMES.manuscript;
    }
    return THEMES.terminal;
  }

  // Retained for the print/HTML path, which keeps its own light stylesheet.
  const TIER_COLORS = THEMES.manuscript.tiers;

  const escXml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));

  const asText = (value, fallback = '—') => {
    if (value == null || value === '') return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  };

  function safeBaseName(value, fallback = 'calliope-scansion') {
    const cleaned = String(value ?? '')
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return cleaned || fallback;
  }

  function firstMeaningfulLine(text) {
    return String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) || 'Untitled verse';
  }

  /**
   * Conservative multi-poem detection. Ordinary single blank lines remain
   * stanza boundaries. A file becomes multi-poem only at form feeds, explicit
   * divider lines, or three-or-more genuinely blank separator lines.
   */
  function splitVerseFile(input) {
    const normalized = String(input ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim();
    if (!normalized) return [];

    const explicitDivider = /^\s*(?:\*{3,}|={3,}|-{5,}|#{3,})\s*$/gm;
    const marked = normalized
      .replace(/\f+/g, '\n\n\n\n')
      .replace(explicitDivider, '\n\n\n\n');
    const blocks = marked
      .split(/\n(?:[ \t]*\n){3,}/)
      .map(text => text.trim())
      .filter(Boolean);

    return blocks.map((text, index) => ({
      index,
      text,
      label: firstMeaningfulLine(text).replace(/^#+\s*/, '').slice(0, 72),
    }));
  }

  function languageOf(data) {
    return data?._lang === 'ru' || data?.meter?.meterRu ? 'Russian' : 'English';
  }

  function lineTag(stanzaIndex, lineIndex) {
    return `S${stanzaIndex + 1}L${lineIndex + 1}`;
  }

  function flattenLines(data) {
    const out = [];
    for (const [stanzaIndex, stanza] of (data?.stanzas ?? []).entries()) {
      for (const [lineIndex, line] of (stanza.lines ?? []).entries()) {
        out.push({ stanza, stanzaIndex, lineIndex, line, tag: lineTag(stanzaIndex, lineIndex) });
      }
    }
    return out;
  }

  function meterSummary(data, line) {
    if (data?._lang === 'ru' || data?.meter?.meterRu) {
      const meter = data?.meter ?? {};
      const label = meter.meterRu || meter.meter || 'unresolved meter';
      const feet = meter.footCount > 0 ? `, ${meter.footCount} feet` : '';
      const fit = Number.isFinite(meter.score) ? `, ${(meter.score * 100).toFixed(1)}% technicality` : '';
      return `${label}${feet}${fit}`;
    }
    const detail = line?.detail ?? {};
    const feet = detail.footCount > 0 ? `, ${detail.footCount} feet` : '';
    const fit = Number.isFinite(detail.certainty) ? `, ${detail.certainty}% fit` : '';
    return `${detail.meter || 'unresolved meter'}${feet}${fit}`;
  }

  function lineStress(line) {
    if (line?.detail?.scansion) return line.detail.scansion;
    return line?.tierPattern || line?.stressPattern || '—';
  }

  function rankingText(line) {
    return (line?.detail?.ranking ?? []).slice(0, 5)
      .map(item => `${item.meter} ${Number(item.score).toFixed(3)}`)
      .join(' · ');
  }

  function rhymeText(data, line, globalIndex) {
    const rhyme = line?.detail?.rhyme ?? data?.rhymes?.[globalIndex];
    if (!rhyme) return '—';
    const letter = rhyme.letter && rhyme.letter !== '-' && rhyme.letter !== '·' ? rhyme.letter : 'unrhymed';
    const endWord = rhyme.endWord ? ` “${rhyme.endWord}”` : '';
    const type = rhyme.type || rhyme.rhymeType;
    return `${letter}${endWord}${type ? ` (${type})` : ''}`;
  }

  function bracketingText(line) {
    const hierarchy = line?.hierarchy;
    const words = line?.words ?? [];
    if (!hierarchy?.length || !words.length) return '—';
    const wordText = index => words[index]?.text ?? words[index]?.form ?? '?';
    return `<${hierarchy.map(iu => `{${(iu.pps ?? []).map(pp =>
      `[${(pp.cps ?? []).map(cp => cp.map(wordText).join(' ')).join('] [')}]`).join(' ')}}`).join(' ')}>`;
  }

  function formatPhonopoetics(data) {
    const p = data?.phonopoetics;
    if (!p) return ['No poem-wide phonopoetics report was emitted.'];
    const out = [];
    if (p.endScheme) out.push(`End-rhyme scheme: ${p.endScheme}`);
    const relation = (label, rows) => {
      if (!rows?.length) return;
      out.push(`${label}:`);
      for (const row of rows) {
        out.push(`  ${row.fromLabel || '?'} “${row.fromWord || '?'}” → ${row.toLabel || '?'} “${row.toWord || '?'}”${row.letter ? ` [${row.letter}]` : ''}${row.type ? ` · ${row.type}` : ''}${row.structure && row.structure !== 'masculine' ? ` · ${row.structure}` : ''}`);
      }
    };
    relation('End rhymes', p.end);
    relation('Caesural rhymes', p.caesural);
    relation('Head rhymes', p.head);
    if (p.alliteration?.length) {
      out.push('Alliteration:');
      for (const row of p.alliteration) out.push(`  ${row.words?.join(' · ') || '—'}${row.label ? ` (${row.label})` : ''}`);
    }
    if (p.acrostics?.length) {
      out.push('Acrostics:');
      for (const row of p.acrostics) out.push(`  ${row.word || '—'}${row.labels?.length ? ` · ${row.labels.join(', ')}` : ''}`);
    }
    return out.length ? out : ['No rhyme-work, alliteration runs, or acrostics surfaced.'];
  }

  function configurationLines(data) {
    if (data?._lang === 'ru' || data?.meter?.meterRu) {
      return [
        'Language: Russian',
        'Engine: Russian scansion (RPST port)',
        Number.isFinite(data?.elapsedMs) ? `Elapsed: ${data.elapsedMs} ms` : null,
      ].filter(Boolean);
    }
    const crosscheck = data?.prosodicCrosscheck || 'off';
    return [
      'Language: English',
      `Engine: ${data?.engine === 'clio' ? 'Clio' : 'Calliope'}`,
      data?.focusPrimacyMode ? `Focus primacy: ${data.focusPrimacyMode === 'spe' ? 'Halle/Chomsky' : 'Wagner'}` : null,
      data?.scoringMode ? `Meter scoring: ${data.scoringMode === 'mcaleese' ? 'McAleese-informed' : 'Current Gradient'}` : null,
      `OT/HG cross-check: ${crosscheck}`,
      data?.fabbHalleMeter ? `Fabb–Halle poem schema: ${data.fabbHalleMeter}` : null,
      Number.isFinite(data?.elapsedMs) ? `Elapsed: ${data.elapsedMs} ms` : null,
    ].filter(Boolean);
  }

  function buildFullReport(data, options = {}) {
    const sourceText = String(options.sourceText ?? flattenLines(data).map(item => item.line.raw).join('\n'));
    const title = options.title || firstMeaningfulLine(sourceText);
    const lines = flattenLines(data);
    const out = [
      'CALLIOPE — FULL SCANSION REPORT',
      `Title/source: ${title}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'SOURCE VERSE',
      sourceText.trim(),
      '',
      'ANALYSIS CONFIGURATION',
      ...configurationLines(data),
      '',
      'FINAL MEASURES / SYNOPSIS',
    ];

    if (data?.meter?.meterRu) out.push(`Meter: ${meterSummary(data, lines[0]?.line)}`);
    for (const item of (data?.synopsis ?? [])) out.push(`${item.label}: ${item.value}`);
    if (data?.rhymeScheme) out.push(`Rhyme scheme: ${data.rhymeScheme}`);
    if (Number.isFinite(data?.score)) out.push(`Technicality: ${data.score.toFixed(3)}`);
    if (data?.enjambment) out.push(`Enjambment: ${data.enjambment}`);
    if (!(data?.synopsis?.length) && !data?.meter) out.push('No poem-wide synopsis was emitted.');

    out.push('', 'PHONOPOETICS', ...formatPhonopoetics(data), '', 'SCANSION / STRESS MAP');
    if (options.stressMap) out.push(String(options.stressMap).trimEnd());
    else {
      for (const item of lines) out.push(`${item.tag}  ${lineStress(item.line)}  ${meterSummary(data, item.line)}  ${item.line.raw}`);
    }

    out.push('', 'LINE-BY-LINE PHONOLOGICAL AND METRICAL NOTES');
    lines.forEach((item, globalIndex) => {
      const line = item.line;
      out.push('', `${item.tag}  ${line.raw}`);
      out.push(`  Final measure: ${meterSummary(data, line)}`);
      out.push(`  Stress/scansion: ${lineStress(line)}`);
      const ranking = rankingText(line);
      if (ranking) out.push(`  Candidate ranking: ${ranking}`);
      out.push(`  Rhyme: ${rhymeText(data, line, globalIndex)}`);
      if (line.detail?.standaloneMeter) out.push(`  Standalone meter: ${line.detail.standaloneMeter}`);
      if (line.detail?.consensusMeter) out.push(`  Continuity consensus: ${line.detail.consensusMeter}`);
      if (line.detail?.rhythmNote) out.push(`  Rhythm note: ${line.detail.rhythmNote}`);
      if (line.detail?.metricalityNote) out.push(`  Metricality note: ${line.detail.metricalityNote}`);
      if (line.detail?.prosodicCrosscheck) {
        const px = line.detail.prosodicCrosscheck;
        out.push(`  OT/HG cross-check: ${px.applied ? 'applied' : 'not applied'} · line ${px.independentMeter || 'undecided'} · document ${px.documentMeter || 'undecided'} · ${px.reason || ''}`.trimEnd());
      }
      const keys = line.keyStresses ?? line.detail?.keyStresses;
      if (keys?.length) out.push(`  Stress evidence: ${keys.map(k => `${k.unitType} ${k.pattern} ×${k.weight}`).join(' · ')}`);
      const bracket = bracketingText(line);
      if (bracket !== '—') out.push(`  Phonological bracketing: ${bracket}`);
      if (line.fabbHalle) out.push(`  Fabb–Halle: ${line.fabbHalle.schema || line.fabbHalle.rule || '—'} · ${line.fabbHalle.metrical ? 'metrical' : 'violations present'}`);
      if (line.scandroid?.verdict) out.push(`  Scandroid: ${line.scandroid.metronName || '—'} · ${line.scandroid.verdict.scanString || '—'} · ${line.scandroid.verdict.substitutions ?? 0} substitution(s)`);
    });

    out.push('', 'Legend: x zero/reduced · w weak · n low lexical/focus · m moderate/secondary · s strong', '');
    return out.join('\n');
  }

  function buildLineMetadata(data, line, options = {}) {
    const stanzaIndex = Number(options.stanzaIndex ?? 0);
    const lineIndex = Number(options.lineIndex ?? 0);
    const globalIndex = flattenLines(data).findIndex(item => item.stanzaIndex === stanzaIndex && item.lineIndex === lineIndex);
    const tag = lineTag(stanzaIndex, lineIndex);
    const context = {
      language: languageOf(data),
      engine: data?.engine ?? (data?.meter ? 'russian' : null),
      focusPrimacyMode: data?.focusPrimacyMode ?? null,
      scoringMode: data?.scoringMode ?? null,
      prosodicCrosscheck: data?.prosodicCrosscheck ?? 'off',
      poemMeter: data?.meter ?? null,
      poemSynopsis: data?.synopsis ?? null,
      poemRhymeScheme: data?.phonopoetics?.endScheme ?? data?.rhymeScheme ?? null,
      lineRhyme: line?.detail?.rhyme ?? data?.rhymes?.[Math.max(0, globalIndex)] ?? null,
    };
    const out = [
      `CALLIOPE — ${tag} LINE METADATA`,
      `Text: ${line?.raw ?? '—'}`,
      `Final measure: ${meterSummary(data, line)}`,
      `Stress/scansion: ${lineStress(line)}`,
      `Candidate ranking: ${rankingText(line) || '—'}`,
      `Rhyme: ${rhymeText(data, line, Math.max(0, globalIndex))}`,
      `Phonological bracketing: ${bracketingText(line)}`,
    ];
    const keys = line?.keyStresses ?? line?.detail?.keyStresses;
    if (keys?.length) out.push(`Stress evidence: ${keys.map(k => `${k.unitType} ${k.pattern} ×${k.weight}`).join(' · ')}`);
    if (line?.detail?.prosodicCrosscheck) {
      const px = line.detail.prosodicCrosscheck;
      out.push(`OT/HG cross-check: ${px.applied ? 'applied' : 'not applied'} · ${px.reason || '—'}`);
    }
    out.push('', 'EXHAUSTIVE STRUCTURED METADATA', JSON.stringify({ tag, context, line }, null, 2), '');
    return out.join('\n');
  }

  function englishRuns(line) {
    if (!line?.segments?.length) return null;
    const runs = [];
    for (const segment of line.segments) {
      if (segment.t === 'gap') {
        runs.push({ text: segment.text, tier: null });
        continue;
      }
      const word = line.words?.[segment.w];
      for (const chunk of (segment.chunks ?? [])) {
        runs.push({ text: chunk.text, tier: word?.syls?.[chunk.si]?.rel || 'w' });
      }
    }
    return runs;
  }

  function russianRuns(line) {
    const raw = String(line?.raw ?? '');
    const words = line?.words ?? [];
    if (!words.length) return [{ text: raw, tier: null }];
    const tokenRe = /[\p{L}Ёё]+(?:[-'’][\p{L}Ёё]+)*/gu;
    const runs = [];
    let cursor = 0;
    let wordIndex = 0;
    let match;
    while ((match = tokenRe.exec(raw)) !== null) {
      if (match.index > cursor) runs.push({ text: raw.slice(cursor, match.index), tier: null });
      const word = words[wordIndex++];
      const syllables = word?.syllables?.filter(s => s.vowel) ?? [];
      const joined = syllables.map(s => s.text).join('');
      if (syllables.length && joined.replace(/[-'’]/g, '').toLocaleLowerCase('ru') === match[0].replace(/[-'’]/g, '').toLocaleLowerCase('ru')) {
        syllables.forEach(s => runs.push({ text: s.text, tier: s.tier || (s.stressed ? 's' : s.secondaryStressed ? 'm' : 'w') }));
      } else {
        runs.push({ text: match[0], tier: word?.tierPattern?.[0] || null });
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < raw.length) runs.push({ text: raw.slice(cursor), tier: null });
    return runs;
  }

  function colorRuns(data, line) {
    return englishRuns(line) || russianRuns(line);
  }

  function splitRunsForSvg(runs, maxUnits = 78) {
    const rows = [[]];
    let units = 0;
    for (const run of runs) {
      const pieces = String(run.text).split(/(\s+)/);
      for (const piece of pieces) {
        if (!piece) continue;
        const size = [...piece].length;
        const isSpace = /^\s+$/.test(piece);
        if (!isSpace && units > 0 && units + size > maxUnits) {
          rows.push([]);
          units = 0;
        }
        if (!(isSpace && units === 0)) {
          rows[rows.length - 1].push({ text: piece, tier: run.tier });
          units += size;
        }
      }
    }
    return rows;
  }

  function summaryPairs(data) {
    const pairs = [];
    if (data?.meter?.meterRu) pairs.push(['Meter', meterSummary(data)]);
    for (const row of (data?.synopsis ?? [])) pairs.push([row.label, asText(row.value)]);
    if (data?.rhymeScheme && !pairs.some(([label]) => /rhyme/i.test(label))) pairs.push(['Rhyme scheme', data.rhymeScheme]);
    if (data?.enjambment) pairs.push(['Enjambment', data.enjambment]);
    if (!pairs.length) {
      const counts = new Map();
      for (const item of flattenLines(data)) {
        const meter = meterSummary(data, item.line).split(',')[0];
        counts.set(meter, (counts.get(meter) ?? 0) + 1);
      }
      for (const [meter, count] of counts) pairs.push(['Measure', `${meter} ×${count}`]);
    }
    return pairs.slice(0, 10);
  }

  function buildColorSvg(data, options = {}) {
    const theme = themeOf(options.theme);
    const TIER = theme.tiers;
    const sourceText = options.sourceText || flattenLines(data).map(item => item.line.raw).join('\n');
    const title = options.title || firstMeaningfulLine(sourceText);
    const width = 1200;
    const margin = 74;
    const poemRows = [];
    for (const item of flattenLines(data)) {
      const wrapped = splitRunsForSvg(colorRuns(data, item.line));
      poemRows.push({ ...item, wrapped });
    }
    const summary = summaryPairs(data);
    const poemHeight = poemRows.reduce((sum, item) =>
      sum + 33 + item.wrapped.length * 34 + (item.lineIndex === item.stanza.lines.length - 1 ? 15 : 0), 0);
    const height = Math.max(620, 190 + poemHeight + 90 + summary.length * 28 + 110);
    let y = 68;
    const body = [];

    body.push(`<rect width="${width}" height="${height}" fill="${theme.ground}"/>`);
    body.push(`<rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="${theme.frame}" stroke-width="2"/>`);
    body.push(`<text x="${margin}" y="${y}" font-family="${theme.serif}" font-size="29" font-weight="700" fill="${theme.title}">${escXml(title)}</text>`);
    y += 32;
    body.push(`<text x="${margin}" y="${y}" font-family="ui-monospace, monospace" font-size="13" letter-spacing="1.5" fill="${theme.sub}">CALLIOPE · ${escXml(languageOf(data).toUpperCase())} GRADIENT PROSODY</text>`);
    y += 44;

    for (const item of poemRows) {
      body.push(`<text x="${margin}" y="${y}" font-family="ui-monospace, monospace" font-size="12" fill="${theme.tag}">${item.tag}</text>`);
      let first = true;
      for (const row of item.wrapped) {
        const textY = first ? y : y + 34;
        const x = first ? margin + 58 : margin + 58;
        let tspans = `<tspan x="${x}" y="${textY}">`;
        for (const run of row) tspans += `<tspan fill="${run.tier ? TIER[run.tier] || theme.body : theme.body}">${escXml(run.text)}</tspan>`;
        tspans += '</tspan>';
        body.push(`<text xml:space="preserve" font-family="${theme.serif}" font-size="25" font-weight="600">${tspans}</text>`);
        if (!first) y += 34;
        first = false;
      }
      y += 27;
      body.push(`<text x="${margin + 58}" y="${y}" font-family="ui-monospace, monospace" font-size="13" fill="${theme.measure}">${escXml(lineStress(item.line))} · ${escXml(meterSummary(data, item.line))}</text>`);
      y += 39;
      if (item.lineIndex === item.stanza.lines.length - 1) y += 15;
    }

    y += 8;
    body.push(`<line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" stroke="${theme.rule}"/>`);
    y += 34;
    body.push(`<text x="${margin}" y="${y}" font-family="ui-monospace, monospace" font-size="15" font-weight="700" letter-spacing="1" fill="${theme.heading}">FINAL SUMMATION</text>`);
    y += 29;
    for (const [label, value] of summary) {
      body.push(`<text x="${margin}" y="${y}" font-family="${theme.serif}" font-size="17" fill="${theme.body}"><tspan font-weight="700">${escXml(label)}:</tspan><tspan> ${escXml(value)}</tspan></text>`);
      y += 27;
    }
    y += 23;
    const legend = Object.entries(TIER).map(([tier, color], index) =>
      `<tspan fill="${color}" font-weight="700">${tier}</tspan><tspan fill="${theme.legend}">${[' zero/reduced', ' weak', ' low', ' moderate', ' strong'][index]}${index < 4 ? '   ' : ''}</tspan>`).join('');
    body.push(`<text x="${margin}" y="${y}" font-family="ui-monospace, monospace" font-size="13">${legend}</text>`);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Calliope gradient stress scansion of ${escXml(title)}">${body.join('')}</svg>`;
  }

  function runsToHtml(runs) {
    return runs.map(run => `<span${run.tier ? ` class="tier-${run.tier}"` : ''}>${escXml(run.text)}</span>`).join('');
  }

  function buildPrintHtml(data, options = {}) {
    const sourceText = options.sourceText || flattenLines(data).map(item => item.line.raw).join('\n');
    const title = options.title || firstMeaningfulLine(sourceText);
    const rows = flattenLines(data).map(item => `
      <article class="verse-line">
        <div class="tag">${item.tag}</div>
        <div class="verse">${runsToHtml(colorRuns(data, item.line))}</div>
        <div class="measure">${escXml(lineStress(item.line))} · ${escXml(meterSummary(data, item.line))}</div>
      </article>`).join('');
    const summary = summaryPairs(data).map(([label, value]) => `<dt>${escXml(label)}</dt><dd>${escXml(value)}</dd>`).join('');
    const colors = Object.entries(TIER_COLORS).map(([tier, color]) => `.tier-${tier}{color:${color};font-weight:${tier === 's' || tier === 'm' ? 700 : 600}}`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escXml(title)} — Calliope</title>
<style>
  @page{size:auto;margin:18mm} *{box-sizing:border-box} html{background:#e5dcc8}
  body{max-width:900px;margin:0 auto;padding:42px 54px;background:#f4eddc;color:#332d27;font-family:Georgia,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1{margin:0;font-size:30px} .kicker{margin:8px 0 34px;color:#6e5c43;font:12px ui-monospace,monospace;letter-spacing:1.5px}
  .verse-line{break-inside:avoid;margin:0 0 22px;padding-left:58px;position:relative}.tag{position:absolute;left:0;top:7px;color:#8b7654;font:11px ui-monospace,monospace}
  .verse{font-size:24px;font-weight:600;line-height:1.35;white-space:pre-wrap}.measure{margin-top:4px;color:#695d50;font:12px ui-monospace,monospace}
  .summary{break-before:auto;margin-top:44px;padding-top:22px;border-top:1px solid #9a7b35}.summary h2{color:#7f2722;font:700 15px ui-monospace,monospace;letter-spacing:1px}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:7px 18px}dt{font-weight:700}dd{margin:0}.legend{margin-top:24px;font:12px ui-monospace,monospace}
  ${colors}
  @media print{html{background:white}body{max-width:none;margin:0;padding:0;background:#f4eddc}button{display:none}}
</style></head><body>
<h1>${escXml(title)}</h1><div class="kicker">CALLIOPE · ${escXml(languageOf(data).toUpperCase())} GRADIENT PROSODY</div>
${rows}
<section class="summary"><h2>FINAL SUMMATION</h2><dl>${summary}</dl>
<div class="legend"><span class="tier-x">x zero/reduced</span> · <span class="tier-w">w weak</span> · <span class="tier-n">n low</span> · <span class="tier-m">m moderate</span> · <span class="tier-s">s strong</span></div></section>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));<\/script>
</body></html>`;
  }

  root.CalliopeReportUtils = Object.freeze({
    TIER_COLORS,
    safeBaseName,
    splitVerseFile,
    buildFullReport,
    buildLineMetadata,
    buildColorSvg,
    buildPrintHtml,
  });
}(typeof window !== 'undefined' ? window : globalThis));
