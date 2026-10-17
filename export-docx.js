// Renders CVFormat blocks to a .docx that mirrors the original CV:
// US Letter, 1" margins, Times New Roman 11pt, 20pt name, ruled bold headings,
// 0.49" hanging indents for citations, borderless date/description tables.
(function (root) {
  const lib = typeof require === 'function' && typeof module !== 'undefined' ? require('docx') : root.docx;
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, TableLayoutType,
  } = lib;

  const TWIPS_PER_INCH = 1440;
  const CONTENT_WIDTH = 6.5 * TWIPS_PER_INCH;
  const HANGING = 706;
  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const NO_BORDERS = {
    top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
    insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
  };

  const run = (r, lineBreak) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italic, break: lineBreak ? 1 : undefined });

  // One paragraph; extra lines are joined with line breaks (as in the teaching entries).
  function linesToParagraph(lines, opts = {}) {
    const children = [];
    lines.forEach((runs, i) => {
      runs.forEach((r, j) => children.push(run(r, i > 0 && j === 0)));
    });
    return new Paragraph({ children, ...opts });
  }

  function paragraphFor(block) {
    if (block.type === 'title') {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: block.text, bold: true, size: 40 })],
      });
    }
    if (block.type === 'center') {
      return new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(block.text)] });
    }
    if (block.type === 'heading') {
      return new Paragraph({
        spacing: { before: 240, after: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: '000000' } },
        keepNext: true,
        children: [new TextRun({ text: block.text, bold: true })],
      });
    }
    return linesToParagraph(block.lines, {
      spacing: { after: block.tight ? 0 : 120 },
      indent: block.hanging ? { left: HANGING, hanging: HANGING } : undefined,
    });
  }

  function datedTable(block) {
    const dateW = Math.round(block.dateWidth * TWIPS_PER_INCH);
    const textW = CONTENT_WIDTH - dateW;
    const cell = (width, paragraphs) => new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      margins: { top: 29, bottom: 29, left: 0, right: 108 },
      children: paragraphs,
    });
    const rows = block.rows.map(r => {
      // Multi-line entries (e.g., positions) get a gap after them, like the original.
      const gap = r.lines.length > 1 ? { after: 120 } : undefined;
      const lines = r.lines.length ? r.lines : [''];
      return new TableRow({
        cantSplit: true,
        children: [
          cell(dateW, [new Paragraph({ children: [new TextRun(r.date)], spacing: gap })]),
          cell(textW, lines.map((l, i) => new Paragraph({
            children: [new TextRun(l)],
            spacing: i === lines.length - 1 ? gap : undefined,
          }))),
        ],
      });
    });
    return new Table({
      rows,
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [dateW, textW],
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
    });
  }

  function buildDocument(blocks) {
    const children = blocks.map(b => (b.type === 'dated' ? datedTable(b) : paragraphFor(b)));
    return new Document({
      creator: '',
      title: 'Curriculum Vitae',
      styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      }],
    });
  }

  const api = {
    toBlob: blocks => Packer.toBlob(buildDocument(blocks)),
    toBuffer: blocks => Packer.toBuffer(buildDocument(blocks)),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CVExport = api;
})(typeof self !== 'undefined' ? self : this);
