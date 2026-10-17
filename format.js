// Turns CV data into format-neutral blocks. The live preview and the .docx
// export both render from these blocks, so they cannot drift apart.
(function (root) {
  const STATUS_LABEL = {
    'in-press': 'in press',
    'in-prep': 'in preparation',
    submitted: 'initial submission',
    revision: 'revision submitted',
  };

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = text => (text ? [{ text }] : []);
  const endsWithPunct = s => /[.?!]$/.test(s.trim());

  // Bolds the owner's name ("Lastname, F." also matches "Lastname, F.M.").
  function boldAuthor(text, prefix) {
    const p = (prefix || '').trim();
    if (!text || !p) return plain(text);
    const re = new RegExp(escapeRe(p) + '(?:\\s?[A-Z]\\.)*', 'g');
    const runs = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index) });
      runs.push({ text: m[0], bold: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push({ text: text.slice(last) });
    return runs;
  }

  // Sentence-ends a title: "Title." but "Title?" stays as is.
  function titleRuns(title) {
    const t = (title || '').trim();
    if (!t) return [];
    return plain(/[?!.]$/.test(t) ? t + ' ' : t + '. ');
  }

  function venueRuns(venue) {
    const v = (venue || '').trim();
    if (!v) return [];
    return [{ text: endsWithPunct(v) ? v : v + '.', italic: true }];
  }

  function publicationRuns(e, cfg) {
    const when = e.status === 'published' || !STATUS_LABEL[e.status]
      ? ` (${e.year || 'n.d.'}). `
      : ` (${STATUS_LABEL[e.status]}) `;
    return [
      ...boldAuthor(e.authors, cfg.boldAuthor),
      { text: when },
      ...titleRuns(e.title),
      ...venueRuns(e.venue),
    ];
  }

  function presentationRuns(e, cfg) {
    // APA: "Title [Poster presentation]. Venue." (no period before the bracket)
    const title = (e.title || '').trim().replace(/\.$/, '');
    const kind = e.kind ? ` [${e.kind}]` : '';
    return [
      ...boldAuthor(e.authors, cfg.boldAuthor),
      { text: ` (${e.date || 'n.d.'}). ` },
      ...plain(title + kind + (title || kind ? '. ' : '')),
      ...plain((e.venue || '').trim()),
    ];
  }

  function teachingLines(e) {
    const lines = [[{ text: e.role || '', bold: true }, { text: e.term ? `, ${e.term}` : '' }]];
    if (e.institution) lines.push([{ text: e.institution, italic: true }]);
    if (e.course) lines.push(plain(`Course: ${e.course}`));
    if (e.rating) {
      const mean = e.deptMean ? ` (Department Mean: ${e.deptMean})` : '';
      lines.push(plain(`Overall Student Rating: ${e.rating}/5.00${mean}`));
    }
    return lines;
  }

  function buildBlocks(cv) {
    const cfg = cv.header;
    const blocks = [
      { type: 'title', text: cfg.name },
      { type: 'center', text: cfg.contact },
      { type: 'center', text: cfg.affiliation },
    ];
    for (const sec of cv.sections) {
      if (sec.hidden || !sec.entries.length) continue;
      blocks.push({ type: 'heading', text: sec.title });
      switch (sec.type) {
        case 'publication':
          for (const e of sec.entries) {
            blocks.push({ type: 'para', lines: [publicationRuns(e, cfg)], hanging: true });
          }
          break;
        case 'presentation':
          for (const e of sec.entries) {
            blocks.push({ type: 'para', lines: [presentationRuns(e, cfg)], hanging: true });
          }
          break;
        case 'teaching':
          for (const e of sec.entries) blocks.push({ type: 'para', lines: teachingLines(e) });
          break;
        case 'text':
          for (const e of sec.entries) blocks.push({ type: 'para', lines: [plain(e.text)] });
          break;
        case 'list':
          for (const e of sec.entries) blocks.push({ type: 'para', lines: [plain(e.text)] });
          break;
        case 'dated':
          blocks.push({
            type: 'dated',
            dateWidth: sec.dateWidth || 1.5,
            rows: sec.entries.map(e => ({ date: e.date || '', lines: e.lines || [] })),
          });
          break;
      }
    }
    return blocks;
  }

  const api = { STATUS_LABEL, buildBlocks, boldAuthor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CVFormat = api;
})(typeof self !== 'undefined' ? self : this);
