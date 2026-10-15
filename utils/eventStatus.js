const { config } = require("../config");

const IMMINENT_HOURS = Number(config.IMMINENT_HOURS || 72);
const SHOW_CONCLUDED_HOURS = Number(config.SHOW_CONCLUDED_HOURS || 12);

function computeEventStatus(event, now = new Date()) {
  try {
    const startValue = event?.date || event?.dateStart;
    const start = startValue ? new Date(startValue) : null;
    const endValue = event?.endDate || event?.dateEnd;
    const end = endValue ? new Date(endValue) : start;

    if (!start || Number.isNaN(start.getTime())) {
      return "future";
    }

    const nowTime = new Date(now).getTime();
    const startTime = start.getTime();
    const endTime = end && !Number.isNaN(end.getTime())
      ? end.getTime()
      : startTime;
    const imminentMs = IMMINENT_HOURS * 60 * 60 * 1000;
    const concludedMs = SHOW_CONCLUDED_HOURS * 60 * 60 * 1000;

    if (nowTime < startTime) {
      return startTime - nowTime <= imminentMs ? "imminent" : "future";
    }

    if (nowTime <= endTime) {
      return "ongoing";
    }

    return nowTime - endTime <= concludedMs ? "concluded" : "past";
  } catch {
    return "future";
  }
}

function getPrivateUnlockCutoff(now = new Date()) {
  const nowTime = new Date(now).getTime();
  const safeNowTime = Number.isFinite(nowTime) ? nowTime : Date.now();
  return new Date(
    safeNowTime - SHOW_CONCLUDED_HOURS * 60 * 60 * 1000
  );
}

module.exports = {
  computeEventStatus,
  getPrivateUnlockCutoff,
};
