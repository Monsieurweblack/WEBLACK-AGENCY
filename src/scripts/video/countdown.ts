let initialized = false;

export function initCountdown() {
  if (initialized) return;
  initialized = true;

  const els = document.querySelectorAll<HTMLElement>("[data-countdown]");
  if (els.length === 0) return;

  function format(ms: number, labels: { day: string; hour: string; minute: string }): string {
    if (ms <= 0) return "";
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}${labels.day} ${hours}${labels.hour}`;
    if (hours > 0) return `${hours}${labels.hour} ${minutes}${labels.minute}`;
    return `${minutes}${labels.minute}`;
  }

  function tick() {
    els.forEach((el) => {
      const target = el.dataset.countdownTarget;
      if (!target) return;
      const remaining = new Date(target).getTime() - Date.now();
      const labels = {
        day: el.dataset.labelDay ?? "d",
        hour: el.dataset.labelHour ?? "h",
        minute: el.dataset.labelMinute ?? "min",
      };
      el.textContent = format(remaining, labels);
    });
  }

  tick();
  setInterval(tick, 60000);
}
