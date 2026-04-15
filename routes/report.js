const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const { pool } = require('../config/db');
const {
  formatSeconds,
  normalizeReportDate,
  formatReportDate,
  formatDayWithDate,
  formatTimeOnly,
  requireReportDate,
  buildReportFilename
} = require('../utils/formatters');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

async function fetchReportLogs(userId, reportDate = '') {
  const params = [userId];
  let dateFilter = 'WHERE t.user_id = ?';

  if (reportDate) {
    dateFilter += ' AND DATE(t.task_date) = ?';
    params.push(reportDate);
  }

  const [logs] = await pool.query(
    `SELECT
       t.id AS task_id,
       t.task_name,
       t.task_date,
       MIN(l.start_time) AS start_time,
       CASE
         WHEN SUM(CASE WHEN l.end_time IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
         ELSE MAX(l.end_time)
       END AS end_time,
       SUM(
         CASE
           WHEN l.end_time IS NULL THEN GREATEST(TIMESTAMPDIFF(SECOND, l.start_time, NOW()), 0)
           ELSE GREATEST(IFNULL(l.duration, 0), 0)
         END
       ) AS duration,
       COUNT(l.id) AS session_count
     FROM task_logs l
     INNER JOIN tasks t ON t.id = l.task_id
     ${dateFilter}
     GROUP BY t.id, t.task_name, t.task_date
     ORDER BY MIN(l.start_time) DESC, t.id DESC`,
    params
  );

  return logs;
}

async function getReportSummary(userId, reportDate = '') {
  const logs = await fetchReportLogs(userId, reportDate);
  const totalDuration = logs.reduce((sum, log) => sum + Number(log.duration || 0), 0);

  return { logs, totalDuration };
}

function createPdfReportLayout(doc, reportDate, logs, totalDuration, reportOwnerName = '') {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowHeight = 28;
  const taskNameColumnIndex = 1;
  const baseColumns = [
    { label: '#', width: 35, align: 'left' },
    { label: 'Task Name', width: 170, align: 'left' },
    { label: 'Task Date', width: 95, align: 'left' },
    { label: 'Start Time', width: 140, align: 'left' },
    { label: 'End Time', width: 140, align: 'left' },
    { label: 'Sessions', width: 70, align: 'right' },
    { label: 'Duration', width: 90, align: 'right' }
  ];
  const baseWidthTotal = baseColumns.reduce((sum, column) => sum + column.width, 0);
  const widthScale = usableWidth / baseWidthTotal;
  const columns = baseColumns.map((column) => ({
    ...column,
    width: Math.max(Math.floor(column.width * widthScale), 32)
  }));
  const assignedWidth = columns.reduce((sum, column) => sum + column.width, 0);
  columns[columns.length - 1].width += usableWidth - assignedWidth;

  function sanitizeCellText(value) {
    return String(value ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function getFooterTopLimit() {
    return doc.page.height - doc.page.margins.bottom;
  }

  function drawHeader() {
    const bandTop = doc.page.margins.top;
    const ownerName = String(reportOwnerName || 'User').trim() || 'User';
    doc.save();
    doc.roundedRect(startX, bandTop, usableWidth, 70, 10).fill('#0f4c81');
    doc.restore();

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(ownerName, startX + 18, bandTop + 14);
    doc.font('Helvetica').fontSize(11).text(reportDate ? `Daily Report Work - ${formatDayWithDate(reportDate)}` : 'Daily Report Work - All Dates', startX + 18, bandTop + 42);

    const generatedAt = new Date().toLocaleString('en-IN');
    doc.font('Helvetica').fontSize(10).text(`Generated: ${generatedAt}`, startX + usableWidth - 190, bandTop + 46, {
      width: 175,
      align: 'right'
    });

    doc.fillColor('#1f2937');
    return bandTop + 88;
  }

  function drawSummary(summaryTop) {
    const gap = 12;
    const chipWidth = Math.floor((usableWidth - gap * 2) / 3);
    const chips = [
      { title: 'Total Records', value: String(logs.length) },
      { title: 'Total Duration', value: formatSeconds(totalDuration) },
      { title: 'Report Day', value: formatDayWithDate(reportDate) }
    ];

    chips.forEach((chip, index) => {
      const x = startX + index * (chipWidth + gap);
      doc.save();
      doc.roundedRect(x, summaryTop, chipWidth, 44, 8).fill('#f2f7ff');
      doc.restore();

      doc.fillColor('#6b7280').font('Helvetica').fontSize(9).text(chip.title, x + 10, summaryTop + 8);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(chip.value, x + 10, summaryTop + 22, {
        width: chipWidth - 20,
        ellipsis: true
      });
    });

    doc.fillColor('#1f2937');
    return summaryTop + 56;
  }

  function drawTableHeader(y) {
    doc.save();
    doc.roundedRect(startX, y, usableWidth, rowHeight, 4).fill('#e4edf7');
    doc.restore();

    let currentX = startX;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1f2937');

    columns.forEach((column) => {
      doc.save();
      doc.rect(currentX, y, column.width, rowHeight).lineWidth(0.6).strokeColor('#c4d2e3').stroke();
      doc.restore();

      doc.text(column.label, currentX + 8, y + 6, {
        width: column.width - 16,
        align: column.align,
        lineBreak: false,
        ellipsis: true
      });
      currentX += column.width;
    });

    return y + rowHeight;
  }

  function drawTotalBlock(y) {
    const blockHeight = 30;
    doc.save();
    doc.roundedRect(startX, y, usableWidth, blockHeight, 6).fill('#e8f5e9');
    doc.restore();

    doc.fillColor('#1b5e20').font('Helvetica-Bold').fontSize(11).text('Total Daily Work Duration', startX + 12, y + 9);
    doc.text(formatSeconds(totalDuration), startX, y + 9, {
      width: usableWidth - 12,
      align: 'right'
    });

    doc.fillColor('#1f2937');
  }

  function drawRow(log, index, rowY) {
    const currentRowHeight = getRowHeight(log);

    if (index % 2 === 0) {
      doc.save();
      doc.rect(startX, rowY, usableWidth, currentRowHeight).fill('#fcfdff');
      doc.restore();
    }

    const cells = [
      String(index + 1),
      sanitizeCellText(log.task_name),
      formatReportDate(log.task_date),
      formatTimeOnly(log.start_time),
      log.end_time ? formatTimeOnly(log.end_time) : 'Running',
      String(log.session_count || 0),
      formatSeconds(log.duration || 0)
    ];

    let currentX = startX;
    doc.font('Helvetica').fontSize(10).fillColor('#111827');

    cells.forEach((cell, cellIndex) => {
      doc.save();
      doc.rect(currentX, rowY, columns[cellIndex].width, currentRowHeight).lineWidth(0.4).strokeColor('#dbe2ea').stroke();
      doc.restore();

      // Clip text to each cell so long/multiline values never spill into adjacent rows.
      doc.save();
      doc.rect(currentX + 1, rowY + 1, columns[cellIndex].width - 2, currentRowHeight - 2).clip();
      doc.text(sanitizeCellText(cell), currentX + 8, rowY + 6, {
        width: columns[cellIndex].width - 16,
        height: currentRowHeight - 10,
        align: columns[cellIndex].align,
        ellipsis: cellIndex === taskNameColumnIndex ? false : true,
        lineBreak: cellIndex === taskNameColumnIndex
      });
      doc.restore();
      currentX += columns[cellIndex].width;
    });

    return rowY + currentRowHeight;
  }

  function getRowHeight(log) {
    const taskNameText = sanitizeCellText(log.task_name);

    doc.font('Helvetica').fontSize(10);
    const textHeight = doc.heightOfString(taskNameText, {
      width: columns[taskNameColumnIndex].width - 16,
      align: 'left',
      lineBreak: true
    });

    return Math.max(rowHeight, Math.ceil(textHeight) + 10);
  }

  function drawPageChrome() {
    let rowY = drawHeader();
    rowY = drawSummary(rowY);
    rowY = drawTableHeader(rowY);
    return rowY;
  }

  return {
    rowHeight,
    getRowHeight,
    drawPageChrome,
    drawRow,
    drawTotalBlock,
    getFooterTopLimit
  };
}

function createExcelReportSheet(workbook, logs, totalDuration) {
  const worksheet = workbook.addWorksheet('Report');

  worksheet.columns = [
    { header: '#', key: 'index', width: 8 },
    { header: 'Task Name', key: 'task_name', width: 28 },
    { header: 'Task Date', key: 'task_date', width: 16 },
    { header: 'Start Time', key: 'start_time', width: 24 },
    { header: 'End Time', key: 'end_time', width: 24 },
    { header: 'Sessions', key: 'session_count', width: 12 },
    { header: 'Duration', key: 'duration', width: 14 }
  ];

  logs.forEach((log, index) => {
    worksheet.addRow({
      index: index + 1,
      task_name: log.task_name,
      task_date: formatReportDate(log.task_date),
      start_time: formatTimeOnly(log.start_time),
      end_time: log.end_time ? formatTimeOnly(log.end_time) : 'Running',
      session_count: Number(log.session_count || 0),
      duration: formatSeconds(log.duration || 0)
    });
  });

  worksheet.addRow({});
  const totalRow = worksheet.addRow({
    task_name: 'Total Daily Work Duration',
    duration: formatSeconds(totalDuration)
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE9EEF7' }
  };
  totalRow.font = { bold: true };

  return worksheet;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(value, maxLength) {
  const text = String(value ?? '').trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(maxLength - 1, 0)).trimEnd()}…`;
}

function buildSvgTextLines(text, maxChars) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length > maxChars && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    currentLine = candidate;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [''];
}

function createSvgReportMarkup(reportDate, logs, totalDuration, reportOwnerName = '') {
  const width = 1600;
  const margin = 48;
  const innerWidth = width - margin * 2;
  const titleTop = 44;
  const headerHeight = 120;
  const summaryHeight = 84;
  const minRowHeight = 54;
  const footerHeight = 78;
  const tableHeaderHeight = 44;
  const tableColumnsBase = [
    { label: '#', weight: 0.55, align: 'middle', maxChars: 4, maxLines: 1 },
    { label: 'Task Name', weight: 3.9, align: 'start', maxChars: 44, maxLines: 3 },
    { label: 'Task Date', weight: 1.45, align: 'middle', maxChars: 16, maxLines: 1 },
    { label: 'Start Time', weight: 1.7, align: 'middle', maxChars: 16, maxLines: 1 },
    { label: 'End Time', weight: 1.7, align: 'middle', maxChars: 16, maxLines: 1 },
    { label: 'Sessions', weight: 1.1, align: 'middle', maxChars: 8, maxLines: 1 },
    { label: 'Duration', weight: 1.5, align: 'middle', maxChars: 16, maxLines: 1 }
  ];
  const totalWeight = tableColumnsBase.reduce((sum, column) => sum + column.weight, 0);
  const tableColumns = tableColumnsBase.map((column) => ({
    ...column,
    width: Math.floor((innerWidth * column.weight) / totalWeight)
  }));
  const assignedWidth = tableColumns.reduce((sum, column) => sum + column.width, 0);
  tableColumns[tableColumns.length - 1].width += innerWidth - assignedWidth;
  const tableWidth = innerWidth;

  function toCellLines(value, maxChars, maxLines) {
    const text = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const lines = buildSvgTextLines(text, maxChars);

    if (lines.length <= maxLines) {
      return lines;
    }

    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = truncateText(clipped[maxLines - 1], Math.max(maxChars - 1, 1));
    return clipped;
  }

  const preparedRows = logs.map((log, index) => {
    const rowValues = [
      String(index + 1),
      String(log.task_name || ''),
      formatReportDate(log.task_date),
      formatTimeOnly(log.start_time),
      log.end_time ? formatTimeOnly(log.end_time) : 'Running',
      String(log.session_count || 0),
      formatSeconds(log.duration || 0)
    ];

    const linesByCell = rowValues.map((value, cellIndex) => {
      const column = tableColumns[cellIndex];
      return toCellLines(value, column.maxChars, column.maxLines);
    });

    const maxLinesInRow = linesByCell.reduce((max, lines) => Math.max(max, lines.length), 1);
    const rowHeight = Math.max(minRowHeight, 22 + maxLinesInRow * 16);

    return {
      values: rowValues,
      linesByCell,
      rowHeight
    };
  });

  const bodyHeight = preparedRows.length
    ? preparedRows.reduce((sum, row) => sum + row.rowHeight, 0)
    : minRowHeight;
  const height = margin * 2 + headerHeight + summaryHeight + tableHeaderHeight + bodyHeight + footerHeight + 42;
  const ownerName = String(reportOwnerName || 'User').trim() || 'User';
  const generatedAt = new Date().toLocaleString('en-IN');
  const headerTitle = reportDate ? `Daily Report Work - ${formatDayWithDate(reportDate)}` : 'Daily Report Work - All Dates';
  const reportDay = formatDayWithDate(reportDate);
  const stats = [
    { label: 'Total Records', value: String(logs.length) },
    { label: 'Total Duration', value: formatSeconds(totalDuration) },
    { label: 'Report Day', value: reportDay }
  ];

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet">`;
  svg += `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef4fb"/>
      <stop offset="100%" stop-color="#f8fbff"/>
    </linearGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0f4c81"/>
      <stop offset="100%" stop-color="#1d73b7"/>
    </linearGradient>
    <style>
      .title { font: 700 32px 'Segoe UI', 'Arial', sans-serif; fill: #ffffff; }
      .subtitle { font: 400 16px 'Segoe UI', 'Arial', sans-serif; fill: #e8f3ff; }
      .meta { font: 400 14px 'Segoe UI', 'Arial', sans-serif; fill: #d7e8f6; }
      .cardTitle { font: 700 14px 'Segoe UI', 'Arial', sans-serif; fill: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
      .cardValue { font: 700 20px 'Segoe UI', 'Arial', sans-serif; fill: #111827; }
      .tableHead { font: 700 14px 'Segoe UI', 'Arial', sans-serif; fill: #1f2937; }
      .tableCell { font: 400 13px 'Segoe UI', 'Arial', sans-serif; fill: #111827; }
      .footerLabel { font: 700 18px 'Segoe UI', 'Arial', sans-serif; fill: #1b5e20; }
      .footerValue { font: 700 22px 'Segoe UI', 'Arial', sans-serif; fill: #1b5e20; }
    </style>
  </defs>`;
  svg += `<rect width="100%" height="100%" fill="url(#bg)"/>`;
  svg += `<rect x="${margin}" y="${margin}" width="${innerWidth}" height="${headerHeight}" rx="20" fill="url(#hero)"/>`;
  svg += `<text x="${margin + 28}" y="${margin + titleTop}" class="title">${escapeXml(ownerName)}</text>`;
  svg += `<text x="${margin + 28}" y="${margin + 72}" class="subtitle">${escapeXml(headerTitle)}</text>`;
  svg += `<text x="${width - margin - 28}" y="${margin + 72}" text-anchor="end" class="meta">Generated: ${escapeXml(generatedAt)}</text>`;

  const cardY = margin + headerHeight + 22;
  const cardWidth = Math.floor((innerWidth - 24) / 3);
  stats.forEach((stat, index) => {
    const cardX = margin + index * (cardWidth + 12);
    svg += `<rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${summaryHeight}" rx="14" fill="#f2f7ff" stroke="#d9e6f5"/>`;
    svg += `<text x="${cardX + 16}" y="${cardY + 28}" class="cardTitle">${escapeXml(stat.label)}</text>`;
    svg += `<text x="${cardX + 16}" y="${cardY + 58}" class="cardValue">${escapeXml(stat.value)}</text>`;
  });

  const tableY = cardY + summaryHeight + 24;
  svg += `<rect x="${margin}" y="${tableY}" width="${tableWidth}" height="${tableHeaderHeight}" rx="8" fill="#e4edf7" stroke="#c4d2e3"/>`;

  let currentX = margin;
  tableColumns.forEach((column) => {
    svg += `<line x1="${currentX}" y1="${tableY}" x2="${currentX}" y2="${tableY + tableHeaderHeight}" stroke="#c4d2e3"/>`;
    const textX = currentX + 10;
    const anchor = column.align === 'middle' ? 'middle' : 'start';
    const middleX = column.align === 'middle' ? currentX + column.width / 2 : textX;
    svg += `<text x="${middleX}" y="${tableY + 28}" text-anchor="${anchor}" class="tableHead">${escapeXml(column.label)}</text>`;
    currentX += column.width;
  });
  svg += `<line x1="${margin + tableWidth}" y1="${tableY}" x2="${margin + tableWidth}" y2="${tableY + tableHeaderHeight}" stroke="#c4d2e3"/>`;

  const bodyStartY = tableY + tableHeaderHeight;
  if (preparedRows.length === 0) {
    svg += `<rect x="${margin}" y="${bodyStartY}" width="${tableWidth}" height="${minRowHeight}" fill="#ffffff" stroke="#dbe2ea"/>`;
    svg += `<text x="${margin + tableWidth / 2}" y="${bodyStartY + 34}" text-anchor="middle" class="tableCell" fill="#4b5563">No sessions logged for the selected date.</text>`;
  } else {
    let rowY = bodyStartY;
    preparedRows.forEach((row, index) => {
      const fill = index % 2 === 0 ? '#fcfdff' : '#ffffff';
      svg += `<rect x="${margin}" y="${rowY}" width="${tableWidth}" height="${row.rowHeight}" fill="${fill}" stroke="#dbe2ea"/>`;

      let cellX = margin;
      row.values.forEach((value, cellIndex) => {
        const column = tableColumns[cellIndex];
        const anchor = column.align === 'middle' ? 'middle' : 'start';
        const textX = column.align === 'middle' ? cellX + column.width / 2 : cellX + 10;
        const lines = row.linesByCell[cellIndex];
        const lineHeight = 16;
        const textBlockHeight = Math.max(lines.length, 1) * lineHeight;
        const startY = rowY + (row.rowHeight - textBlockHeight) / 2 + 12;

        lines.forEach((line, lineIndex) => {
          svg += `<text x="${textX}" y="${startY + lineIndex * lineHeight}" text-anchor="${anchor}" class="tableCell">${escapeXml(line)}</text>`;
        });

        cellX += column.width;
      });

      rowY += row.rowHeight;
    });
  }

  const footerY = bodyStartY + bodyHeight + 22;
  svg += `<rect x="${margin}" y="${footerY}" width="${tableWidth}" height="56" rx="10" fill="#e8f5e9" stroke="#cde8d0"/>`;
  svg += `<text x="${margin + 18}" y="${footerY + 34}" class="footerLabel">Total Daily Work Duration</text>`;
  svg += `<text x="${margin + tableWidth - 18}" y="${footerY + 34}" text-anchor="end" class="footerValue">${escapeXml(formatSeconds(totalDuration))}</text>`;
  svg += `</svg>`;

  return svg;
}

router.get('/report', async (req, res) => {
  const userId = Number(req.session.user?.id || 0);

  try {
    const reportDate = normalizeReportDate(req.query.date);
    const { logs, totalDuration } = await getReportSummary(userId, reportDate);

    res.render('report', {
      logs,
      formatSeconds,
      selectedDate: reportDate,
      formatReportDate,
      formatDayWithDate,
      formatTimeOnly,
      totalDuration
    });
  } catch (error) {
    res.status(500).send('Unable to load report. Check database connection.');
  }
});

router.get('/report/export/excel', async (req, res) => {
  const userId = Number(req.session.user?.id || 0);

  try {
    const reportDate = normalizeReportDate(req.query.date);

    if (!requireReportDate(res, reportDate, 'Excel')) {
      return;
    }

    const { logs, totalDuration } = await getReportSummary(userId, reportDate);
    const workbook = new ExcelJS.Workbook();
    createExcelReportSheet(workbook, logs, totalDuration);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${buildReportFilename('report', reportDate, 'xlsx')}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).send('Unable to export Excel report.');
  }
});

router.get('/report/export/pdf', async (req, res) => {
  const userId = Number(req.session.user?.id || 0);
  const reportOwnerName = String(req.session.user?.full_name || '').trim();

  try {
    const reportDate = normalizeReportDate(req.query.date);

    if (!requireReportDate(res, reportDate, 'PDF')) {
      return;
    }

    const { logs, totalDuration } = await getReportSummary(userId, reportDate);
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${buildReportFilename('report', reportDate, 'pdf')}"`);

    doc.pipe(res);
    const startX = doc.page.margins.left;
    const layout = createPdfReportLayout(doc, reportDate, logs, totalDuration, reportOwnerName);
    let rowY = layout.drawPageChrome();

    if (logs.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#4b5563').text('No sessions logged for the selected date.', startX + 8, rowY + 12);
    } else {
      logs.forEach((log, index) => {
        const nextRowHeight = layout.getRowHeight(log);
        const footerTopLimit = layout.getFooterTopLimit();

        if (rowY + nextRowHeight > footerTopLimit) {
          doc.addPage();
          rowY = layout.drawPageChrome();
        }

        rowY = layout.drawRow(log, index, rowY);
      });
    }

    if (rowY + 34 > layout.getFooterTopLimit()) {
      doc.addPage();
      rowY = layout.drawPageChrome();
    }

    layout.drawTotalBlock(rowY + 8);

    doc.end();
  } catch (error) {
    res.status(500).send('Unable to export PDF report.');
  }
});

router.get('/report/export/image', async (req, res) => {
  const userId = Number(req.session.user?.id || 0);
  const reportOwnerName = String(req.session.user?.full_name || '').trim();

  try {
    const reportDate = normalizeReportDate(req.query.date);

    if (!requireReportDate(res, reportDate, 'Image')) {
      return;
    }

    const { logs, totalDuration } = await getReportSummary(userId, reportDate);
    const svgMarkup = createSvgReportMarkup(reportDate, logs, totalDuration, reportOwnerName);
    const pngBuffer = await sharp(Buffer.from(svgMarkup))
      .png({ quality: 100, compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${buildReportFilename('report', reportDate, 'png')}"`);
    res.send(pngBuffer);
  } catch (error) {
    res.status(500).send('Unable to export image report.');
  }
});

module.exports = router;
