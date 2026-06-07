// backend/services/campaignMemoryScheduler.js
// Campaign Memory Engine V1 — scheduler automatico snapshot promo concluse

const { config } = require("../config");
const { logger } = require("../core/logger");
const { processEndedCampaignSnapshots } = require("./campaignMemoryService");

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;

let schedulerHandle = null;
let isRunning = false;
let lastRun = null;

function normalizeIntervalMs(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(parsed, MIN_INTERVAL_MS);
}

function isSchedulerEnabled() {
  return String(config.CAMPAIGN_MEMORY_SCHEDULER_ENABLED || "false").toLowerCase() === "true";
}

async function runCampaignMemorySchedulerCycle(reason = "scheduled") {
  if (isRunning) {
    logger.warn(`[CampaignMemoryScheduler] cycle skipped: previous cycle still running (${reason})`);
    return {
      ok: false,
      skipped: true,
      reason: "already_running",
    };
  }

  isRunning = true;
  const startedAt = new Date();

  try {
    const result = await processEndedCampaignSnapshots({
      limit: config.CAMPAIGN_MEMORY_SCHEDULER_LIMIT,
      nowDate: startedAt,
    });

    lastRun = {
      ok: true,
      reason,
      startedAt,
      finishedAt: new Date(),
      processed: result.processed,
      created: result.created,
    };

    logger.info(
      `[CampaignMemoryScheduler] cycle completed (${reason}) processed=${result.processed} created=${result.created}`
    );

    return {
      ok: true,
      skipped: false,
      result,
    };
  } catch (err) {
    lastRun = {
      ok: false,
      reason,
      startedAt,
      finishedAt: new Date(),
      error: err?.code || err?.message || "CAMPAIGN_MEMORY_SCHEDULER_ERROR",
    };

    logger.error("[CampaignMemoryScheduler] cycle failed:", err);

    return {
      ok: false,
      skipped: false,
      error: lastRun.error,
    };
  } finally {
    isRunning = false;
  }
}

function startCampaignMemoryScheduler() {
  if (!isSchedulerEnabled()) {
    logger.info("[CampaignMemoryScheduler] disabled");
    return null;
  }

  if (schedulerHandle) {
    logger.warn("[CampaignMemoryScheduler] already started");
    return schedulerHandle;
  }

  const intervalMs = normalizeIntervalMs(config.CAMPAIGN_MEMORY_SCHEDULER_INTERVAL_MS);
  const startupDelayMs = Math.max(
    0,
    Number(config.CAMPAIGN_MEMORY_SCHEDULER_STARTUP_DELAY_MS || DEFAULT_STARTUP_DELAY_MS)
  );

  logger.info(
    `[CampaignMemoryScheduler] enabled intervalMs=${intervalMs} limit=${config.CAMPAIGN_MEMORY_SCHEDULER_LIMIT}`
  );

  setTimeout(() => {
    runCampaignMemorySchedulerCycle("startup").catch((err) => {
      logger.error("[CampaignMemoryScheduler] startup cycle error:", err);
    });
  }, startupDelayMs);

  schedulerHandle = setInterval(() => {
    runCampaignMemorySchedulerCycle("scheduled").catch((err) => {
      logger.error("[CampaignMemoryScheduler] scheduled cycle error:", err);
    });
  }, intervalMs);

  if (typeof schedulerHandle.unref === "function") {
    schedulerHandle.unref();
  }

  return schedulerHandle;
}

function getCampaignMemorySchedulerState() {
  return {
    enabled: isSchedulerEnabled(),
    running: isRunning,
    started: Boolean(schedulerHandle),
    lastRun,
  };
}

module.exports = {
  startCampaignMemoryScheduler,
  runCampaignMemorySchedulerCycle,
  getCampaignMemorySchedulerState,
};
