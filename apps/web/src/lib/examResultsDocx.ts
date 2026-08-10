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
  TableLayoutType,
} from 'docx';

export interface ExamResultDocxItem {
  no?: number;
  nisn?: string;
  full_name: string;
  class_name?: string;
  total_questions?: number;
  total_correct?: number;
  total_wrong?: number;
  total_unanswered?: number;
  score: number;
  room_name?: string;
  status_pengerjaan?: string;
}

export interface ExamResultsDocxOptions {
  event_name?: string;
  exam_title: string;
  subject_name?: string;
  institution_name?: string;
  sub_title?: string;
  room_name?: string;
  sortBy: 'name' | 'score';
  results: ExamResultDocxItem[];
}

const DEFAULT_INSTITUTION = 'MADRASAH ALIYAH NEGERI 1 TASIKMALAYA';
const DEFAULT_SUBTITLE = 'PANITIA PELAKSANA UJIAN & CBT';

// Total printable width on A4 Portrait (210mm = 11906 twips) with 2cm margins (1134 twips each side):
// 11906 - (1134 * 2) = 9638 twips
const TOTAL_TABLE_WIDTH = 9638;

// Column width distribution for 8 columns (in twips):
// Col 0: NO (450 twips ~4.7%)
// Col 1: NISN (1400 twips ~14.5%)
// Col 2: NAMA PESERTA (3038 twips ~31.5%) - Generous room for full student names
// Col 3: KELAS (1000 twips ~10.4%)
// Col 4: BENAR (900 twips ~9.3%)
// Col 5: SALAH (850 twips ~8.8%)
// Col 6: KOSONG (800 twips ~8.3%)
// Col 7: NILAI AKHIR (1200 twips ~12.5%)
const COLUMN_WIDTHS = [450, 1400, 3038, 1000, 900, 850, 800, 1200];

export async function generateExamResultsDocx(options: ExamResultsDocxOptions): Promise<Blob> {
  const institution = options.institution_name || DEFAULT_INSTITUTION;
  const subTitle = options.sub_title || DEFAULT_SUBTITLE;
  const eventName = options.event_name || 'UJIAN CBT';
  const examTitle = options.exam_title || 'HASIL UJIAN';
  const roomName = options.room_name || 'Semua Ruangan / Kelas';
  const sortBy = options.sortBy || 'score';

  // Sort results
  const sortedResults = [...options.results].sort((a, b) => {
    if (sortBy === 'score') {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.full_name || '').localeCompare(b.full_name || '');
    }
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  // Calculate statistics
  const scores = sortedResults.map((r) => Number(r.score) || 0);
  const totalCount = sortedResults.length;
  const maxScore = totalCount > 0 ? Math.max(...scores) : 0;
  const minScore = totalCount > 0 ? Math.min(...scores) : 0;
  const avgScore = totalCount > 0 ? (scores.reduce((a, b) => a + b, 0) / totalCount).toFixed(2) : '0';

  const sortLabel = sortBy === 'score' ? 'Peringkat Nilai Tertinggi' : 'Nama Peserta (A-Z)';

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
      spacing: { before: 100 },
      children: [
        new TextRun({
          text: 'DAFTAR HASIL PENGERJAAN UJIAN',
          bold: true,
          size: 26, // 13pt
          font: 'Arial',
          color: '1E3A8A',
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: `UJIAN: ${examTitle.toUpperCase()} (${eventName.toUpperCase()})`,
          bold: true,
          size: 20, // 10pt
          font: 'Arial',
          color: '374151',
        }),
      ],
    }),
  ];

  // Metadata Table (Borderless Grid)
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
                  new TextRun({ text: 'Nama Ujian     : ', bold: true, size: 19, font: 'Arial' }),
                  new TextRun({ text: examTitle, bold: true, color: '1E40AF', size: 19, font: 'Arial' }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: 'Ruang / Kelas  : ', bold: true, size: 19, font: 'Arial' }),
                  new TextRun({ text: roomName, size: 19, font: 'Arial' }),
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
                  new TextRun({ text: 'Pengurutan      : ', bold: true, size: 19, font: 'Arial' }),
                  new TextRun({ text: sortLabel, bold: true, color: '374151', size: 19, font: 'Arial' }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: 'Total Peserta  : ', bold: true, size: 19, font: 'Arial' }),
                  new TextRun({ text: `${totalCount} Peserta`, bold: true, size: 19, font: 'Arial' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Summary Statistics Box
  const summaryBox = new Table({
    columnWidths: [2409, 2409, 2410, 2410],
    layout: TableLayoutType.FIXED,
    width: { size: TOTAL_TABLE_WIDTH, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2409, type: WidthType.DXA },
            shading: { fill: 'F9FAFB' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 20, after: 20 },
                children: [
                  new TextRun({ text: 'JUMLAH PESERTA\n', size: 15, color: '6B7280', font: 'Arial' }),
                  new TextRun({ text: `${totalCount}`, bold: true, size: 22, color: '111827', font: 'Arial' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 2409, type: WidthType.DXA },
            shading: { fill: 'F9FAFB' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 20, after: 20 },
                children: [
                  new TextRun({ text: 'NILAI TERTINGGI\n', size: 15, color: '6B7280', font: 'Arial' }),
                  new TextRun({ text: `${maxScore}`, bold: true, size: 22, color: '15803D', font: 'Arial' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 2410, type: WidthType.DXA },
            shading: { fill: 'F9FAFB' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 20, after: 20 },
                children: [
                  new TextRun({ text: 'NILAI TERENDAH\n', size: 15, color: '6B7280', font: 'Arial' }),
                  new TextRun({ text: `${minScore}`, bold: true, size: 22, color: 'B91C1C', font: 'Arial' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 2410, type: WidthType.DXA },
            shading: { fill: 'F9FAFB' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 20, after: 20 },
                children: [
                  new TextRun({ text: 'RATA-RATA NILAI\n', size: 15, color: '6B7280', font: 'Arial' }),
                  new TextRun({ text: `${avgScore}`, bold: true, size: 22, color: '1E40AF', font: 'Arial' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const spacingParagraph = new Paragraph({ spacing: { before: 120 } });

  // Main Table Headers
  const tableHeaderRow = new TableRow({
    cantSplit: true,
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NO', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NISN', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'NAMA PESERTA', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'KELAS', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'BENAR', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'SALAH', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'F3F4F6' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'KOSONG', bold: true, size: 18, font: 'Arial' })] })],
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[7], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { fill: 'E0F2FE' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NILAI', bold: true, size: 18, color: '0369A1', font: 'Arial' })] })],
      }),
    ],
  });

  const dataRows: TableRow[] = sortedResults.map((item, idx) => {
    const isEven = idx % 2 === 1;
    const bgFill = isEven ? 'F9FAFB' : 'FFFFFF';
    const scoreVal = Number(item.score || 0);

    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: COLUMN_WIDTHS[0], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: `${idx + 1}`, size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[1], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: item.nisn || '-', size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[2], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ spacing: { before: 10, after: 10 }, children: [new TextRun({ text: item.full_name, size: 18, font: 'Arial' })] })], // NOT BOLD
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[3], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: item.class_name || '-', size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[4], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: `${item.total_correct ?? '-'}`, bold: true, color: '15803D', size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: `${item.total_wrong ?? '-'}`, color: 'B91C1C', size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: bgFill },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: `${item.total_unanswered ?? '-'}`, color: '6B7280', size: 18, font: 'Arial' })] })],
        }),
        new TableCell({
          width: { size: COLUMN_WIDTHS[7], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: { fill: isEven ? 'F0F9FF' : 'F8FAFC' },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 10 }, children: [new TextRun({ text: `${scoreVal}`, bold: true, size: 20, color: '0369A1', font: 'Arial' })] })],
        }),
      ],
    });
  });

  const mainTable = new Table({
    columnWidths: COLUMN_WIDTHS,
    layout: TableLayoutType.FIXED,
    width: { size: TOTAL_TABLE_WIDTH, type: WidthType.DXA },
    margins: {
      top: 40,
      bottom: 40,
      left: 80,
      right: 80,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
    },
    rows: [tableHeaderRow, ...dataRows],
  });

  // Footer Signature Block
  const dateFormatted = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

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
              new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: 'Mengetahui,', size: 18, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: 'Penanggung Jawab CBT', bold: true, size: 18, font: 'Arial' })] }),
              new Paragraph({ spacing: { before: 650 }, children: [new TextRun({ text: '( .................................................... )', size: 18, font: 'Arial' })] }),
              new Paragraph({ children: [new TextRun({ text: 'NIP. ', size: 17, font: 'Arial' })] }),
            ],
          }),
          new TableCell({
            width: { size: 4819, type: WidthType.DXA },
            children: [
              new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 240 }, children: [new TextRun({ text: `Tasikmalaya, ${dateFormatted}`, size: 18, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Ketua Panitia Ujian', bold: true, size: 18, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 650 }, children: [new TextRun({ text: '( .................................................... )', size: 18, font: 'Arial' })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'NIP. ', size: 17, font: 'Arial' })] }),
            ],
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 Width in twips
              height: 16838, // A4 Height in twips
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: 1134,
              bottom: 1134,
              left: 1134,
              right: 1134,
            },
          },
        },
        children: [
          ...headerParagraphs,
          metaTable,
          new Paragraph({ spacing: { before: 100 } }),
          summaryBox,
          spacingParagraph,
          mainTable,
          signatureTable,
        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
}

export function downloadResultsDocxBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
