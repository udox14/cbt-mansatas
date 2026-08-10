import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalAlignTable,
  BorderStyle,
  PageOrientation,
  VerticalMergeType,
  TableLayoutType,
} from 'docx';

export interface ParticipantDocxData {
  no?: number;
  nisn?: string;
  full_name: string;
  gender?: string; // L / P
  mapel?: string;
}

export interface MapelAttendanceData {
  exam_id?: string;
  subject_name: string;
  title?: string;
  tanggal_tes?: string;
  sesi_tes?: string;
  room_name?: string;
  participants: ParticipantDocxData[];
}

export interface AttendanceDocxOptions {
  event_name: string;
  event_code?: string;
  institution_name?: string;
  sub_title?: string;
  room_name?: string;
  mapels: MapelAttendanceData[];
}

const DEFAULT_INSTITUTION = 'MADRASAH ALIYAH NEGERI 1 TASIKMALAYA';
const DEFAULT_SUBTITLE = 'PANITIA PELAKSANA UJIAN & CBT';

// Total printable width on A4 Portrait (210mm = 11906 twips) with 2cm margins (1134 twips each side):
// 11906 - (1134 * 2) = 9638 twips
const TOTAL_TABLE_WIDTH = 9638;

// Column width distribution for 7 columns (in twips):
// Col 0: NO (500 twips ~5.2%)
// Col 1: NISN (1200 twips ~12.5%)
// Col 2: NAMA PESERTA (3838 twips ~39.8%) - Super wide for long names!
// Col 3: JK (450 twips ~4.7%)
// Col 4: MAPEL (1250 twips ~13.0%)
// Col 5: GANJIL (1200 twips ~12.4%)
// Col 6: GENAP (1200 twips ~12.4%)
const COLUMN_WIDTHS = [500, 1200, 3838, 450, 1250, 1200, 1200];

export async function generateAttendanceDocx(options: AttendanceDocxOptions): Promise<Blob> {
  const institution = options.institution_name || DEFAULT_INSTITUTION;
  const subTitle = options.sub_title || DEFAULT_SUBTITLE;
  const eventName = options.event_name || 'UJIAN CBT';

  const sections = options.mapels.map((mapel) => {
    const subjectTitle = mapel.subject_name || mapel.title || 'Mata Pelajaran';
    const roomName = mapel.room_name || options.room_name || 'Semua Ruangan';
    const tanggal = mapel.tanggal_tes || '-';
    const sesi = mapel.sesi_tes || '-';
    const participants = mapel.participants || [];

    // Header Kop
    const headerParagraphs = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: subTitle.toUpperCase(),
            bold: true,
            size: 18, // 9pt
            font: 'Arial',
            color: '4B5563',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: institution.toUpperCase(),
            bold: true,
            size: 24, // 12pt
            font: 'Arial',
            color: '111827',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120 },
        children: [
          new TextRun({
            text: 'DAFTAR HADIR PESERTA UJIAN',
            bold: true,
            size: 28, // 14pt
            font: 'Arial',
            color: '1E3A8A',
            underline: {},
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: `KEGIATAN: ${eventName.toUpperCase()}`,
            bold: true,
            size: 22, // 11pt
            font: 'Arial',
            color: '374151',
          }),
        ],
      }),
    ];

    // Metadata Grid Table (Borderless)
    const metaTable = new Table({
      columnWidths: [4819, 4819],
      layout: TableLayoutType.FIXED,
      width: { size: TOTAL_TABLE_WIDTH, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 4819, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Mata Pelajaran : ', bold: true, size: 20, font: 'Arial' }),
                    new TextRun({ text: subjectTitle, bold: true, color: '1E40AF', size: 20, font: 'Arial' }),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Ruangan          : ', bold: true, size: 20, font: 'Arial' }),
                    new TextRun({ text: roomName, size: 20, font: 'Arial' }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 4819, type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Hari / Tanggal : ', bold: true, size: 20, font: 'Arial' }),
                    new TextRun({ text: tanggal, size: 20, font: 'Arial' }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Sesi / Waktu    : ', bold: true, size: 20, font: 'Arial' }),
                    new TextRun({ text: sesi, size: 20, font: 'Arial' }),
                    new TextRun({ text: `  (${participants.length} Peserta)`, bold: true, color: '4B5563', size: 20, font: 'Arial' }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const spacingParagraph = new Paragraph({ spacing: { before: 180 } });

    // Table Header Rows (2 Rows: Main header & Sub-header for Tanda Tangan)
    const tableHeaderRow1 = new TableRow({
      cantSplit: true,
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
          verticalMerge: VerticalMergeType.RESTART,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NO', bold: true, size: 19, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
          verticalMerge: VerticalMergeType.RESTART,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NISN', bold: true, size: 19, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
          verticalMerge: VerticalMergeType.RESTART,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'NAMA PESERTA', bold: true, size: 19, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
          verticalMerge: VerticalMergeType.RESTART,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'JK', bold: true, size: 19, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
          verticalMerge: VerticalMergeType.RESTART,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'MAPEL', bold: true, size: 19, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[5] + COLUMN_WIDTHS[6], type: WidthType.DXA },
          columnSpan: 2,
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: 'F3F4F6' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TANDA TANGAN', bold: true, size: 19, font: 'Arial' })] })],
        }),
      ],
    });

    const tableHeaderRow2 = new TableRow({
      cantSplit: true,
      tableHeader: true,
      children: [
        new TableCell({ width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA }, verticalMerge: VerticalMergeType.CONTINUE, children: [] }),
        new TableCell({ width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA }, verticalMerge: VerticalMergeType.CONTINUE, children: [] }),
        new TableCell({ width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA }, verticalMerge: VerticalMergeType.CONTINUE, children: [] }),
        new TableCell({ width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA }, verticalMerge: VerticalMergeType.CONTINUE, children: [] }),
        new TableCell({ width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA }, verticalMerge: VerticalMergeType.CONTINUE, children: [] }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
          shading: { fill: 'F9FAFB' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'GANJIL', bold: true, size: 17, color: '6B7280', font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
          shading: { fill: 'F9FAFB' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'GENAP', bold: true, size: 17, color: '6B7280', font: 'Arial' })] })],
        }),
      ],
    });

    const dataRows: TableRow[] = [];

    // Loop participants in pairs of 2 (odd & even side-to-side vertically merged signature)
    for (let i = 0; i < participants.length; i += 2) {
      const p1 = participants[i];
      const p2 = participants[i + 1];

      const no1 = i + 1;
      const no2 = i + 2;

      if (p2) {
        // Pair: p1 (odd) and p2 (even)
        // Row 1 (for p1)
        const row1 = new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${no1}`, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p1.nisn || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: p1.full_name, bold: true, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p1.gender || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: subjectTitle, size: 18, font: 'Arial' })] })],
            }),
            // Signature Ganjil (Col 5): "1." - Vertical Merge RESTART across 2 rows
            new TableCell({
              width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
              verticalMerge: VerticalMergeType.RESTART,
              verticalAlign: VerticalAlignTable.TOP,
              children: [new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `${no1}.`, bold: true, size: 18, color: '374151', font: 'Arial' })] })],
            }),
            // Signature Genap (Col 6): "2." - Vertical Merge RESTART across 2 rows
            new TableCell({
              width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
              verticalMerge: VerticalMergeType.RESTART,
              verticalAlign: VerticalAlignTable.TOP,
              children: [new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `${no2}.`, bold: true, size: 18, color: '374151', font: 'Arial' })] })],
            }),
          ],
        });

        // Row 2 (for p2)
        const row2 = new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${no2}`, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p2.nisn || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: p2.full_name, bold: true, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p2.gender || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: subjectTitle, size: 18, font: 'Arial' })] })],
            }),
            // Signature Ganjil (Col 5): Vertical Merge CONTINUE
            new TableCell({
              width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
              verticalMerge: VerticalMergeType.CONTINUE,
              children: [],
            }),
            // Signature Genap (Col 6): Vertical Merge CONTINUE
            new TableCell({
              width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
              verticalMerge: VerticalMergeType.CONTINUE,
              children: [],
            }),
          ],
        });

        dataRows.push(row1, row2);
      } else {
        // Single last odd participant (no p2)
        const row1 = new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${no1}`, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p1.nisn || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: p1.full_name, bold: true, size: 19, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p1.gender || '-', size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [new Paragraph({ children: [new TextRun({ text: subjectTitle, size: 18, font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.TOP,
              children: [new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `${no1}.`, bold: true, size: 18, color: '374151', font: 'Arial' })] })],
            }),
            new TableCell({
              width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
              children: [],
            }),
          ],
        });

        dataRows.push(row1);
      }
    }

    const mainTable = new Table({
      columnWidths: COLUMN_WIDTHS,
      layout: TableLayoutType.FIXED,
      width: { size: TOTAL_TABLE_WIDTH, type: WidthType.DXA },
      margins: {
        top: 80,
        bottom: 80,
        left: 100,
        right: 100,
      },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
        left: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
        right: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
      },
      rows: [tableHeaderRow1, tableHeaderRow2, ...dataRows],
    });

    // Signature Footer Block
    const dateFormatted = tanggal && tanggal !== '-'
      ? tanggal
      : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const signatureTable = new Table({
      columnWidths: [4819, 4819],
      layout: TableLayoutType.FIXED,
      width: { size: TOTAL_TABLE_WIDTH, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 4819, type: WidthType.DXA },
              children: [
                new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'Mengetahui,', size: 19, font: 'Arial' })] }),
                new Paragraph({ children: [new TextRun({ text: 'Pengawas Ujian / Proktor', bold: true, size: 19, font: 'Arial' })] }),
                new Paragraph({ spacing: { before: 800 }, children: [new TextRun({ text: '( .................................................... )', size: 19, font: 'Arial' })] }),
                new Paragraph({ children: [new TextRun({ text: 'NIP. ', size: 18, font: 'Arial' })] }),
              ],
            }),
            new TableCell({
              width: { size: 4819, type: WidthType.DXA },
              children: [
                new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 300 }, children: [new TextRun({ text: `Tasikmalaya, ${dateFormatted}`, size: 19, font: 'Arial' })] }),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Ketua Panitia Ujian', bold: true, size: 19, font: 'Arial' })] }),
                new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 800 }, children: [new TextRun({ text: '( .................................................... )', size: 19, font: 'Arial' })] }),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'NIP. ', size: 18, font: 'Arial' })] }),
              ],
            }),
          ],
        }),
      ],
    });

    return {
      properties: {
        page: {
          size: {
            width: 11906, // A4 Width in twips (210mm)
            height: 16838, // A4 Height in twips (297mm)
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top: 1134, // 2.0 cm
            bottom: 1134, // 2.0 cm
            left: 1134, // 2.0 cm
            right: 1134, // 2.0 cm
          },
        },
      },
      children: [
        ...headerParagraphs,
        metaTable,
        spacingParagraph,
        mainTable,
        signatureTable,
      ],
    };
  });

  const doc = new Document({
    sections,
  });

  return await Packer.toBlob(doc);
}

export function downloadDocxBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
