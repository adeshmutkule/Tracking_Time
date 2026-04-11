const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

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
       SUM(IFNULL(l.duration, 0)) AS duration,
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

function createPdfReportLayout(doc, reportDate, logs, totalDuration) {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowHeight = 28;
  const footerTopOffset = 76;
  const columns = [
    { label: '#', width: 35, align: 'left' },
    { label: 'Task Name', width: 170, align: 'left' },
    { label: 'Task Date', width: 95, align: 'left' },
    { label: 'Start Time', width: 140, align: 'left' },
    { label: 'End Time', width: 140, align: 'left' },
    { label: 'Sessions', width: 70, align: 'right' },
    { label: 'Duration', width: 90, align: 'right' }
  ];
  const supportDetails = [
    'Adesh A Mutkule',
    'Support Engineer',
    '7066179197',
    'adeshmutkule452@gmail.com'
  ];

  function getFooterTopLimit() {
    return doc.page.height - doc.page.margins.bottom - footerTopOffset;
  }

  function drawHeader() {
    const bandTop = doc.page.margins.top;
    doc.save();
    doc.roundedRect(startX, bandTop, usableWidth, 70, 10).fill('#0f4c81');
    doc.restore();

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Adesh A Mutkule', startX + 18, bandTop + 14);
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
    const chipWidth = 185;
    const gap = 12;
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

  function drawFooter() {
    const footerHeight = 62;
    const footerTop = doc.page.height - doc.page.margins.bottom - footerHeight;

    doc.save();
    doc.roundedRect(startX, footerTop, usableWidth, footerHeight, 8).fill('#f8fafc');
    doc.restore();

    doc.fillColor('#0f4c81').font('Helvetica-Bold').fontSize(10).text('Support Contact', startX + 12, footerTop + 9);
    doc.fillColor('#374151').font('Helvetica').fontSize(9).text(supportDetails.join(' | '), startX + 12, footerTop + 26, {
      width: usableWidth - 24,
      ellipsis: true
    });

    doc.fillColor('#6b7280').fontSize(8).text(`Page ${doc.bufferedPageRange().count}`, startX + usableWidth - 70, footerTop + 42, {
      width: 58,
      align: 'right'
    });

    doc.fillColor('#1f2937');
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
    if (index % 2 === 0) {
      doc.save();
      doc.rect(startX, rowY, usableWidth, rowHeight).fill('#fcfdff');
      doc.restore();
    }

    const cells = [
      String(index + 1),
      log.task_name,
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
      doc.rect(currentX, rowY, columns[cellIndex].width, rowHeight).lineWidth(0.4).strokeColor('#dbe2ea').stroke();
      doc.restore();

      doc.text(cell, currentX + 8, rowY + 6, {
        width: columns[cellIndex].width - 16,
        align: columns[cellIndex].align,
        ellipsis: true,
        lineBreak: false
      });
      currentX += columns[cellIndex].width;
    });

    return rowY + rowHeight;
  }

  function drawPageChrome() {
    let rowY = drawHeader();
    rowY = drawSummary(rowY);
    rowY = drawTableHeader(rowY);
    return rowY;
  }

  return {
    rowHeight,
    drawPageChrome,
    drawRow,
    drawFooter,
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
    const layout = createPdfReportLayout(doc, reportDate, logs, totalDuration);
    let rowY = layout.drawPageChrome();

    if (logs.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#4b5563').text('No sessions logged for the selected date.', startX + 8, rowY + 12);
    } else {
      logs.forEach((log, index) => {
        const footerTopLimit = layout.getFooterTopLimit();

        if (rowY + layout.rowHeight > footerTopLimit) {
          layout.drawFooter();
          doc.addPage();
          rowY = layout.drawPageChrome();
        }

        rowY = layout.drawRow(log, index, rowY);
      });
    }

    if (rowY + 34 > layout.getFooterTopLimit()) {
      layout.drawFooter();
      doc.addPage();
      rowY = layout.drawPageChrome();
    }

    layout.drawTotalBlock(rowY + 8);
    layout.drawFooter();

    doc.end();
  } catch (error) {
    res.status(500).send('Unable to export PDF report.');
  }
});

module.exports = router;
