/**
 * A minimal .xlsx writer.
 *
 * WHY THIS EXISTS RATHER THAN A LIBRARY
 *
 * The export is what a creator forwards to a sponsor, and CSV cannot carry any
 * of what makes a document look prepared rather than dumped: no fonts, no column
 * widths, no headings, no number formats, no separate sheets. That is not
 * decoration here. A file that looks careless undermines the figures inside it
 * in front of exactly the person the client is trying to persuade.
 *
 * The obvious answer is a spreadsheet library, and the two usual choices are a
 * megabyte of code in the client's browser or a package with a history of
 * advisories. An xlsx file is a ZIP of small XML documents, and the subset
 * needed here — typed cells, a style table, column widths, frozen headers,
 * several sheets — is short enough to own. It also matches the rest of this
 * project, where the charts are hand-built for the same reason.
 *
 * Files are STORED, not deflated. A report is tens of kilobytes; compression
 * would add an implementation of DEFLATE to save nothing anybody notices.
 */

const enc = new TextEncoder();

/* ---- ZIP ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry { name: string; size: number; crc: number; offset: number }

/**
 * A ZIP archive with every member stored uncompressed.
 *
 * The timestamp is fixed rather than read from the clock, so the same report
 * exported twice is byte-identical and a client can tell whether a file they
 * were sent twice actually changed.
 */
function zip(files: { name: string; text: string }[]): Uint8Array {
  const entries: Entry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const DOS_TIME = 0, DOS_DATE = 0x2100;   // constant, arbitrary

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const f of files) {
    const bytes = enc.encode(f.text);
    const nameBytes = enc.encode(f.name);
    const crc = crc32(bytes);
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(bytes.length), ...u32(bytes.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    entries.push({ name: f.name, size: bytes.length, crc, offset });
    chunks.push(header, bytes);
    offset += header.length + bytes.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const rec = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(e.crc), ...u32(e.size), ...u32(e.size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(e.offset),
      ...nameBytes,
    ]);
    chunks.push(rec);
    offset += rec.length;
  }

  chunks.push(new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(offset - centralStart), ...u32(centralStart), ...u16(0),
  ]));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/* ---- the sheet model ---------------------------------------------------- */

export type CellValue = string | number | null;
export interface Cell { v: CellValue; s?: number }
export type Row = (Cell | CellValue)[];

export interface Sheet {
  name: string;
  /** Column widths, in characters. */
  cols: number[];
  rows: Row[];
  /** Rows to keep visible while scrolling. */
  freeze?: number;
  /** Ranges such as "A1:E1". */
  merges?: string[];
}

/**
 * Style slots.
 *
 * Fixed indices into the style table below, named rather than numbered at the
 * call site: a spreadsheet whose headings silently render as body text is the
 * failure this file exists to prevent, and an off-by-one in a style index is
 * invisible until somebody opens the file.
 */
export const S = {
  BODY: 0,
  BOLD: 1,
  TITLE: 2,
  SECTION: 3,
  HEADER: 4,
  NUMBER: 5,
  PERCENT: 6,
  NOTE: 7,
  MULTIPLE: 8,
  SUBTLE: 9,
} as const;

/**
 * Illegal in XML 1.0. A reader rejects the WHOLE FILE rather than the offending
 * cell, so one stray byte inside one caption would make the entire report refuse
 * to open, and captions arrive from the platform.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(CONTROL_CHARS, "");

function colName(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.cols.length
    ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const pane = sheet.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const rows = sheet.rows.map((cells, r) => {
    const body = cells.map((c, i) => {
      const cell: Cell = (c !== null && typeof c === "object") ? c : { v: c as CellValue };
      const ref = `${colName(i)}${r + 1}`;
      const s = cell.s ? ` s="${cell.s}"` : "";
      // An unknown writes an EMPTY CELL, never 0 and never the text "null". The
      // same rule as everywhere else in this product, and the one the previous
      // CSV broke.
      if (cell.v === null || cell.v === undefined || cell.v === "") return `<c r="${ref}"${s}/>`;
      if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${body}</row>`;
  }).join("");

  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + pane + cols + `<sheetData>${rows}</sheetData>` + merges + `</worksheet>`;
}

/*
 * The style table.
 *
 * Order is not free: readers expect fill 0 to be "none" and fill 1 to be
 * "gray125", and a file omitting them opens with no formatting at all rather
 * than with an error, which is a far harder fault to notice.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
  <numFmt numFmtId="164" formatCode="#,##0"/>
  <numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>
  <numFmt numFmtId="166" formatCode="0.0&quot;x&quot;"/>
</numFmts>
<fonts count="6">
  <font><sz val="11"/><name val="Helvetica Neue"/><color rgb="FF1A1A1E"/></font>
  <font><b/><sz val="11"/><name val="Helvetica Neue"/><color rgb="FF1A1A1E"/></font>
  <font><b/><sz val="18"/><name val="Helvetica Neue"/><color rgb="FFFFFFFF"/></font>
  <font><b/><sz val="12"/><name val="Helvetica Neue"/><color rgb="FFFFFFFF"/></font>
  <font><sz val="9"/><name val="Helvetica Neue"/><color rgb="FF6B6B76"/></font>
  <font><b/><sz val="10"/><name val="Helvetica Neue"/><color rgb="FF1A1A1E"/></font>
</fonts>
<fills count="5">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1F2430"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF4F7CFF"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEFF1F5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top/><bottom style="thin"><color rgb="FFC9CCD4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
  <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

/** Build a workbook. Returns the bytes; wrapping them for download is the caller's job. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  // Excel rejects these characters in a tab name and caps the name at 31.
  const names = sheets.map((s) => s.name.replace(/[\\/*?:[\]]/g, " ").slice(0, 31));

  const files = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
        + `</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
        + `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
        + `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `</Relationships>`,
    },
    { name: "xl/styles.xml", text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];

  return zip(files);
}
