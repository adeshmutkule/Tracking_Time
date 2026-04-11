function formatSeconds(totalSeconds) {
  const safeSeconds = Number(totalSeconds) || 0;
  const hours = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function buildRedirectMessage(basePath, type, message) {
  return `${basePath}?${type}=${encodeURIComponent(message)}`;
}

function normalizeReportDate(dateValue) {
  if (!dateValue) {
    return '';
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return parsedDate.toISOString().slice(0, 10);
}

function formatReportDate(dateValue) {
  if (!dateValue) {
    return '-';
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return '-';
  }

  return parsedDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDayWithDate(dateValue) {
  if (!dateValue) {
    return 'All Dates';
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'All Dates';
  }

  return parsedDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatTimeOnly(dateValue) {
  if (!dateValue) {
    return '-';
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return '-';
  }

  return parsedDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function requireReportDate(res, reportDate, exportLabel) {
  if (reportDate) {
    return true;
  }

  res.status(400).send(`Please select a date before downloading the ${exportLabel} report.`);
  return false;
}

function buildReportFilename(prefix, reportDate, extension) {
  const suffix = reportDate || 'all-dates';
  return `${prefix}-${suffix}.${extension}`;
}

module.exports = {
  formatSeconds,
  buildRedirectMessage,
  normalizeReportDate,
  formatReportDate,
  formatDayWithDate,
  formatTimeOnly,
  requireReportDate,
  buildReportFilename
};
