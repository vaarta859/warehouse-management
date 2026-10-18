// -------------------------------------------------
// pdfExport
//
// A minimal, dependency-free PDF writer. The app has no PDF
// library (jspdf/pdfmake) installed, so this builds raw PDF
// syntax directly - same low-level approach the old inline
// PDF export used, but generalized with real table/grid
// primitives (borders, shaded header row, multi-page) instead
// of just printing lines of text.
//
// Usage:
//   const doc = createPdfDocument();
//   doc.heading("INWARD DETAILS");
//   doc.keyValueGrid([["GRN Number", "GRN-1"], ["Company", "Acme"]]);
//   doc.table({ columns: [...], rows: [...] });
//   doc.save("inward-details");
// -------------------------------------------------

const PAGE_WIDTH = 595; // A4 width in pt
const PAGE_HEIGHT = 842; // A4 height in pt
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

// No real font metrics are available without a PDF library, so
// text-fitting is approximate: Helvetica averages ~0.5x the font
// size per character, which is close enough to keep table cell
// text from overflowing into its neighbour.
function estimateTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.5;
}

function truncateToWidth(value, fontSize, maxWidth) {
  const str = String(value ?? "-");
  if (estimateTextWidth(str, fontSize) <= maxWidth) return str;
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.5)) - 1);
  return `${str.slice(0, Math.max(0, maxChars - 1))}\u2026`;
}

class PdfDocument {
  constructor() {
    this.pages = [];
    this.currentPage = null;
    this.y = MARGIN;
    this.addPage();
  }

  addPage() {
    this.currentPage = { commands: [] };
    this.pages.push(this.currentPage);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  // Starts a new page if the next block of the given height
  // would run past the bottom margin.
  ensureSpace(height) {
    if (this.y - height < MARGIN) {
      this.addPage();
    }
  }

  push(command) {
    this.currentPage.commands.push(command);
  }

  text(x, y, value, { size = 10, bold = false } = {}) {
    const font = bold ? "/F2" : "/F1";
    this.push(`BT ${font} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
  }

  line(x1, y1, x2, y2, width = 0.75) {
    this.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  rect(x, y, w, h, { fill } = {}) {
    if (fill) {
      this.push(`${fill} rg ${x} ${y} ${w} ${h} re f`);
      this.push("0 g");
    } else {
      this.push(`${x} ${y} ${w} ${h} re S`);
    }
  }

  spacer(height) {
    this.ensureSpace(height);
    this.y -= height;
  }

  heading(value, { size = 15, gap = 22 } = {}) {
    this.ensureSpace(gap);
    this.text(MARGIN, this.y, value, { size, bold: true });
    this.y -= gap;
  }

  subheading(value, { size = 11.5, gap = 18 } = {}) {
    this.ensureSpace(gap + 4);
    this.y -= 6;
    this.text(MARGIN, this.y, value, { size, bold: true });
    this.y -= gap - 6;
  }

  paragraph(value, { size = 9.5, gap = 13 } = {}) {
    this.ensureSpace(gap);
    this.text(MARGIN, this.y, value, { size });
    this.y -= gap;
  }

  // Two-per-row (default) label/value pairs — a lightweight
  // "form grid" for header-style details.
  keyValueGrid(pairs, { columns = 2, rowHeight = 28, fontSize = 9 } = {}) {
    const colWidth = CONTENT_WIDTH / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      this.ensureSpace(rowHeight);
      const rowPairs = pairs.slice(i, i + columns);
      rowPairs.forEach(([label, value], index) => {
        const x = MARGIN + index * colWidth;
        this.text(x, this.y, label, { size: fontSize - 1.5 });
        this.text(x, this.y - 12, truncateToWidth(value, fontSize, colWidth - 10), {
          size: fontSize,
          bold: true,
        });
      });
      this.y -= rowHeight;
    }
  }

  // Bordered table with a shaded header row. Columns: [{ header, width }].
  // Rows: array of arrays of cell text (same order as columns).
  table({ columns, rows, rowHeight = 20, fontSize = 8.5 }) {
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    const startX = MARGIN;

    // Try to keep the header row from being the last thing on a page.
    this.ensureSpace(Math.min(rowHeight * 2, PAGE_HEIGHT - MARGIN * 2));

    const drawRow = (cells, { bold = false, fill } = {}) => {
      this.ensureSpace(rowHeight);
      const rowTop = this.y;
      const rowBottom = rowTop - rowHeight;

      if (fill) this.rect(startX, rowBottom, totalWidth, rowHeight, { fill });
      this.rect(startX, rowBottom, totalWidth, rowHeight);

      let cellX = startX;
      columns.forEach((col, index) => {
        if (index > 0) this.line(cellX, rowTop, cellX, rowBottom);
        const cellText = truncateToWidth(cells[index], fontSize, col.width - 8);
        this.text(cellX + 4, rowBottom + rowHeight / 2 - fontSize / 2.6, cellText, {
          size: fontSize,
          bold,
        });
        cellX += col.width;
      });

      this.y = rowBottom;
    };

    drawRow(columns.map((col) => col.header), { bold: true, fill: "0.92 0.92 0.92" });

    if (rows.length === 0) {
      drawRow(["No records", ...columns.slice(1).map(() => "")]);
    } else {
      rows.forEach((row) => drawRow(row));
    }

    this.y -= 12;
  }

  // Assembles every page into PDF bytes and triggers a browser download.
  save(fileBaseName = "document") {
    const catalogIndex = 1;
    const pagesIndex = 2;
    const fontRegularIndex = 3;
    const fontBoldIndex = 4;

    const pageIndices = [];
    const contentIndices = [];
    let nextIndex = 5;

    this.pages.forEach(() => {
      pageIndices.push(nextIndex++);
      contentIndices.push(nextIndex++);
    });

    const objects = [];
    objects[catalogIndex] = `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`;
    objects[pagesIndex] = `<< /Type /Pages /Kids [${pageIndices
      .map((i) => `${i} 0 R`)
      .join(" ")}] /Count ${pageIndices.length} >>`;
    objects[fontRegularIndex] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[fontBoldIndex] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

    this.pages.forEach((page, i) => {
      const pageIndex = pageIndices[i];
      const contentIndex = contentIndices[i];
      const content = page.commands.join("\n");
      objects[pageIndex] =
        `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontRegularIndex} 0 R /F2 ${fontBoldIndex} 0 R >> >> ` +
        `/Contents ${contentIndex} 0 R >>`;
      objects[contentIndex] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 1; i < nextIndex; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${nextIndex}\n0000000000 65535 f \n`;
    for (let i = 1; i < nextIndex; i++) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${nextIndex} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileBaseName}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export function createPdfDocument() {
  return new PdfDocument();
}

export const PDF_CONTENT_WIDTH = CONTENT_WIDTH;
export const PDF_MARGIN = MARGIN;
