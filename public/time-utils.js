(function exposeTimeUtils() {
  function formatSecondsHms(totalSeconds) {
    const safeSeconds = Math.max(Math.floor(Number(totalSeconds) || 0), 0);
    const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(safeSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  window.formatSecondsHms = formatSecondsHms;
})();
