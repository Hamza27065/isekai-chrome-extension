/**
 * Background service worker for the Isekai Agent extension
 * Handles job polling, tab management, and API communication
 */

import { ApiClient } from '../shared/api-client';
import { Logger } from '../shared/logger';
import { Job, Stats, MessageType, JobHistoryItem } from '../shared/types';
import {
  STORAGE_KEYS,
  ALARM_NAMES,
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_MAX_RETRY_DELAY,
  JOB_TIMEOUT,
} from '../shared/constants';

// Track active jobs (tab ID → job)
const activeJobs = new Map<number, Job>();

// Track job timeouts
const jobTimeouts = new Map<number, number>();

// Track local retry attempts for tab closures (job ID → retry count)
const tabClosureRetries = new Map<string, number>();

// Maximum local retries for tab closures before reporting to backend
const MAX_TAB_CLOSURE_RETRIES = 3;

/**
 * Add job to history
 */
async function addJobToHistory(job: Job, status: 'processing' | 'completed' | 'failed'): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.JOB_HISTORY);
  const history: JobHistoryItem[] = result[STORAGE_KEYS.JOB_HISTORY] || [];

  const historyItem: JobHistoryItem = {
    id: job.id,
    title: job.deviation.title,
    url: job.deviation.deviationUrl,
    thumbnailUrl: job.deviation.thumbnailUrl,
    status,
    timestamp: Date.now(),
    price: job.price,
  };

  // Add to beginning of array (newest first)
  history.unshift(historyItem);

  // Keep only last 50 jobs
  const trimmedHistory = history.slice(0, 50);

  await chrome.storage.local.set({ [STORAGE_KEYS.JOB_HISTORY]: trimmedHistory });
}

/**
 * Update job status in history
 */
async function updateJobInHistory(jobId: string, status: 'completed' | 'failed'): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.JOB_HISTORY);
  const history: JobHistoryItem[] = result[STORAGE_KEYS.JOB_HISTORY] || [];

  const jobIndex = history.findIndex(item => item.id === jobId);
  if (jobIndex !== -1) {
    history[jobIndex].status = status;
    history[jobIndex].timestamp = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.JOB_HISTORY]: history });
  }
}

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  Logger.info('Extension installed/updated');

  // Generate client ID if not exists
  const result = await chrome.storage.local.get(STORAGE_KEYS.CLIENT_ID);
  if (!result[STORAGE_KEYS.CLIENT_ID]) {
    const clientId = crypto.randomUUID();
    await chrome.storage.local.set({ [STORAGE_KEYS.CLIENT_ID]: clientId });
    Logger.info(`Generated client ID: ${clientId}`);
  }

  // Initialize stats if not exists
  const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  if (!statsResult[STORAGE_KEYS.STATS]) {
    const initialStats: Stats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: initialStats });
  }

  // Set default polling interval
  const intervalResult = await chrome.storage.local.get(STORAGE_KEYS.POLLING_INTERVAL);
  if (!intervalResult[STORAGE_KEYS.POLLING_INTERVAL]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.POLLING_INTERVAL]: DEFAULT_POLLING_INTERVAL,
    });
  }

  // Set default retry settings
  const retryResult = await chrome.storage.local.get([
    STORAGE_KEYS.RETRY_ATTEMPTS,
    STORAGE_KEYS.MAX_RETRY_DELAY,
  ]);
  if (!retryResult[STORAGE_KEYS.RETRY_ATTEMPTS]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.RETRY_ATTEMPTS]: DEFAULT_RETRY_ATTEMPTS,
    });
  }
  if (!retryResult[STORAGE_KEYS.MAX_RETRY_DELAY]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MAX_RETRY_DELAY]: DEFAULT_MAX_RETRY_DELAY,
    });
  }

  Logger.info('Extension initialization complete');
});

/**
 * Create polling alarm when extension starts
 */
chrome.runtime.onStartup.addListener(async () => {
  Logger.info('Extension started');

  // Check if auto-start is enabled
  const result = await chrome.storage.local.get(STORAGE_KEYS.IS_RUNNING);
  if (result[STORAGE_KEYS.IS_RUNNING]) {
    await startPolling();
  }
});

/**
 * Start job polling
 */
async function startPolling(): Promise<void> {
  try {
    // Test API connection first
    Logger.info('Testing API connection before starting polling...');

    const client = await ApiClient.fromStorage();
    const health = await client.healthCheck();

    Logger.info('API health check successful', { status: health.status });

    const intervalResult = await chrome.storage.local.get(STORAGE_KEYS.POLLING_INTERVAL);
    const interval = intervalResult[STORAGE_KEYS.POLLING_INTERVAL] || DEFAULT_POLLING_INTERVAL;

    // Create alarm for periodic polling
    await chrome.alarms.create(ALARM_NAMES.JOB_POLL, {
      periodInMinutes: interval,
    });

    Logger.info(`Polling started (interval: ${interval} minute${interval > 1 ? 's' : ''})`);

    // Update badge
    await chrome.action.setBadgeBackgroundColor({ color: '#00e59b' });
    await chrome.action.setBadgeText({ text: '•' });

    // Trigger immediate poll
    await pollForJob();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error('Failed to start polling: API health check failed', {
      error: message,
      errorType: error?.constructor?.name,
      errorStack: error instanceof Error ? error.stack : undefined
    });

    // Stop polling and update state
    await chrome.storage.local.set({ [STORAGE_KEYS.IS_RUNNING]: false });
    await chrome.action.setBadgeText({ text: '' });

    throw error;
  }
}

/**
 * Stop job polling
 */
async function stopPolling(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.JOB_POLL);
  Logger.info('Polling stopped');

  // Update badge
  await chrome.action.setBadgeText({ text: '' });
}

/**
 * Poll for next job
 */
async function pollForJob(): Promise<void> {
  try {
    // Check if polling is enabled
    const runningResult = await chrome.storage.local.get(STORAGE_KEYS.IS_RUNNING);
    if (!runningResult[STORAGE_KEYS.IS_RUNNING]) {
      return;
    }

    // Get API key, URL and client ID
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_URL,
      STORAGE_KEYS.CLIENT_ID,
    ]);

    const apiKey = result[STORAGE_KEYS.API_KEY];
    const apiUrl = result[STORAGE_KEYS.API_URL];
    const clientId = result[STORAGE_KEYS.CLIENT_ID];

    if (!apiKey || !apiUrl) {
      Logger.warning('API configuration not set. Please configure in settings.');
      return;
    }

    if (!clientId) {
      Logger.error('Client ID not found');
      return;
    }

    Logger.info('Checking for new jobs in the queue...');

    // Fetch next job from API
    const client = await ApiClient.fromStorage();
    const job = await client.getNextJob(clientId);

    if (!job) {
      Logger.info('Queue is empty - no jobs available');
      return;
    }

    Logger.success(`Received new job: "${job.deviation.title}" (Price: $${Math.round(job.price / 100)}, Attempt ${job.attempts}/3)`);

    // Process the job
    await processJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = {
      message,
      name: error?.constructor?.name || 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined,
      stringified: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    };
    Logger.error(`Polling failed: ${message}`, errorDetails);
  }
}

/**
 * Process a job by opening DeviantArt tab and sending message to content script
 */
async function processJob(job: Job): Promise<void> {
  try {
    // Update stats - mark as processing
    const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const stats: Stats = statsResult[STORAGE_KEYS.STATS] || {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    stats.currentJob = {
      id: job.id,
      title: job.deviation.title,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });

    // Add job to history
    await addJobToHistory(job, 'processing');

    Logger.info(`Opening DeviantArt page in background tab for: "${job.deviation.title}"`);

    // Create background tab for the deviation
    const tab = await chrome.tabs.create({
      url: job.deviation.deviationUrl,
      active: false, // Don't switch to the tab
    });

    if (!tab.id) {
      throw new Error('Failed to create tab');
    }

    Logger.success(`DeviantArt page loaded successfully (Tab ID: ${tab.id})`);

    // Track active job
    activeJobs.set(tab.id, job);

    // Set timeout for job
    const timeoutId = setTimeout(() => {
      handleJobTimeout(tab.id!);
    }, JOB_TIMEOUT) as unknown as number;
    jobTimeouts.set(tab.id, timeoutId);

    // Wait for tab to load, then inject content script
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Inject content script programmatically to ensure it's loaded
        chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          files: ['src/content/deviantart-automation.ts']
        }).then(() => {
          Logger.info('Content script injected successfully', {}, job.id);

          // Wait a bit for script to initialize
          setTimeout(() => {
            sendMessageWithRetry();
          }, 1000);
        }).catch((error) => {
          Logger.error('Failed to inject content script', { error: error.message }, job.id);
          handleJobFailure(tab.id!, job.id, `Failed to inject content script: ${error.message}`);
        });

        // Retry sending message to content script with exponential backoff
        const sendMessageWithRetry = async (attempt: number = 1): Promise<void> => {
          // Load retry settings from storage
          const retrySettings = await chrome.storage.local.get([
            STORAGE_KEYS.RETRY_ATTEMPTS,
            STORAGE_KEYS.MAX_RETRY_DELAY,
          ]);
          const maxAttempts = retrySettings[STORAGE_KEYS.RETRY_ATTEMPTS] || DEFAULT_RETRY_ATTEMPTS;
          const maxRetryDelay = retrySettings[STORAGE_KEYS.MAX_RETRY_DELAY] || DEFAULT_MAX_RETRY_DELAY;

          const delay = Math.min(1000 * Math.pow(2, attempt - 1), maxRetryDelay); // Exponential backoff in seconds

          await new Promise(resolve => setTimeout(resolve, delay));

          try {
            Logger.info(`Sending automation instructions to content script (attempt ${attempt}/${maxAttempts})`, {}, job.id);

            const response = await chrome.tabs.sendMessage(tab.id!, {
              type: 'START_JOB',
              job,
            } as MessageType);

            if (response && response.received) {
              Logger.info('Content script acknowledged job message', {}, job.id);
            } else {
              throw new Error('Content script did not acknowledge message');
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            if (attempt < maxAttempts) {
              Logger.warning(`Failed to send message to content script (attempt ${attempt}/${maxAttempts}), retrying...`, { error: errorMessage }, job.id);
              await sendMessageWithRetry(attempt + 1);
            } else {
              Logger.error(`Failed to communicate with content script after ${maxAttempts} attempts`, { error: errorMessage }, job.id);
              handleJobFailure(tab.id!, job.id, `Failed to communicate with content script after ${maxAttempts} attempts: ${errorMessage}`);
            }
          }
        };

        sendMessageWithRetry();
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`Failed to process job: ${message}`, { jobId: job.id });
    await handleJobFailure(null, job.id, message);
  }
}

/**
 * Handle job timeout
 */
async function handleJobTimeout(tabId: number): Promise<void> {
  const job = activeJobs.get(tabId);
  if (!job) return;

  Logger.warning(`Job ${job.id} timed out`, { jobId: job.id });

  await handleJobFailure(tabId, job.id, 'Job processing timed out after 2 minutes');
}

/**
 * Handle job success
 */
async function handleJobSuccess(tabId: number, jobId: string): Promise<void> {
  const job = activeJobs.get(tabId);
  const jobTitle = job?.deviation?.title || 'Unknown';

  try {
    // Clear timeout
    const timeoutId = jobTimeouts.get(tabId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      jobTimeouts.delete(tabId);
    }

    Logger.success(`Job completed successfully! Exclusive sale for "${jobTitle}" has been listed on DeviantArt`);
    Logger.info('Marking job as complete in backend database...');

    // Mark job as complete in backend
    const client = await ApiClient.fromStorage();
    await client.completeJob(jobId);

    // Update stats
    const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const stats: Stats = statsResult[STORAGE_KEYS.STATS] || {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    stats.processed++;
    stats.succeeded++;
    stats.lastProcessedAt = Date.now();
    delete stats.currentJob;

    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });

    Logger.info(`Total jobs completed: ${stats.succeeded}`);

    // Update badge
    await chrome.action.setBadgeText({ text: stats.succeeded.toString() });

    // Update job in history
    await updateJobInHistory(jobId, 'completed');

    // Clean up
    activeJobs.delete(tabId);
    tabClosureRetries.delete(jobId); // Clean up retry counter

    // Close tab
    Logger.info('Closing DeviantArt tab and cleaning up...');
    await chrome.tabs.remove(tabId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`Error while finalizing job completion: ${message}`);
  }
}

/**
 * Handle job failure
 */
async function handleJobFailure(
  tabId: number | null,
  jobId: string,
  errorMessage: string
): Promise<void> {
  const job = tabId ? activeJobs.get(tabId) : null;
  const jobTitle = job?.deviation?.title || 'Unknown';

  Logger.error(`Job failed for "${jobTitle}": ${errorMessage}`);

  try {
    // Clear timeout if tabId provided
    if (tabId !== null) {
      const timeoutId = jobTimeouts.get(tabId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        jobTimeouts.delete(tabId);
      }
      activeJobs.delete(tabId);
    }

    // Clean up retry counter
    tabClosureRetries.delete(jobId);

    Logger.info('Reporting failure to backend...');

    // Mark job as failed in backend
    const client = await ApiClient.fromStorage();
    const result = await client.failJob(jobId, errorMessage);

    if (result.willRetry) {
      Logger.info(`Job will be retried automatically (Attempt ${(job?.attempts || 0) + 1}/3)`);
    } else {
      Logger.warning(`Job permanently failed - Maximum attempts (3) reached`);
    }

    // Update stats
    const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const stats: Stats = statsResult[STORAGE_KEYS.STATS] || {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    stats.processed++;
    stats.failed++;
    stats.lastProcessedAt = Date.now();
    delete stats.currentJob;

    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });

    // Update job in history
    await updateJobInHistory(jobId, 'failed');

    // Clean up
    if (tabId !== null) {
      activeJobs.delete(tabId);

      // Close tab
      try {
        await chrome.tabs.remove(tabId);
      } catch (_error) {
        // Tab may already be closed
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`Failed to handle job failure: ${message}`, { jobId });
  }
}

/**
 * Listen for alarm events (polling trigger)
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAMES.JOB_POLL) {
    pollForJob();
  }
});

/**
 * Listen for messages from content scripts
 */
chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
  if (message.type === 'JOB_SUCCESS' && message.jobId) {
    const tabId = sender.tab?.id;
    if (tabId) {
      handleJobSuccess(tabId, message.jobId);
    }
    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'JOB_FAILED' && message.jobId && message.error) {
    const tabId = sender.tab?.id || null;
    handleJobFailure(tabId, message.jobId, message.error);
    sendResponse({ received: true });
    return true;
  }

  return false;
});

/**
 * Listen for tab removal (handle unexpected closures)
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const job = activeJobs.get(tabId);
  if (job) {
    // Clean up tracking
    activeJobs.delete(tabId);
    const timeoutId = jobTimeouts.get(tabId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      jobTimeouts.delete(tabId);
    }

    // Get current retry count for this job
    const retryCount = tabClosureRetries.get(job.id) || 0;

    if (retryCount < MAX_TAB_CLOSURE_RETRIES) {
      // Retry locally - don't waste backend retry
      const newRetryCount = retryCount + 1;
      tabClosureRetries.set(job.id, newRetryCount);

      Logger.warning(
        `Tab ${tabId} was closed unexpectedly. Retrying job locally (attempt ${newRetryCount}/${MAX_TAB_CLOSURE_RETRIES})...`,
        { jobId: job.id }
      );

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Retry the job by processing it again
      processJob(job).catch((error) => {
        Logger.error(`Failed to retry job after tab closure: ${error.message}`, {}, job.id);
        handleJobFailure(null, job.id, `Failed to retry after tab closure: ${error.message}`);
      });
    } else {
      // Max local retries exceeded, report to backend
      Logger.error(
        `Tab ${tabId} was closed ${MAX_TAB_CLOSURE_RETRIES} times. Reporting failure to backend.`,
        { jobId: job.id }
      );
      tabClosureRetries.delete(job.id); // Clean up
      handleJobFailure(tabId, job.id, `Tab was closed ${MAX_TAB_CLOSURE_RETRIES} times by user`);
    }
  }
});

/**
 * Listen for messages from popup/console to control polling
 */
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message.action === 'START_POLLING') {
    chrome.storage.local
      .set({ [STORAGE_KEYS.IS_RUNNING]: true })
      .then(() => startPolling())
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'STOP_POLLING') {
    chrome.storage.local
      .set({ [STORAGE_KEYS.IS_RUNNING]: false })
      .then(() => stopPolling())
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'GET_STATUS') {
    chrome.storage.local
      .get([STORAGE_KEYS.IS_RUNNING, STORAGE_KEYS.STATS])
      .then((result) => {
        sendResponse({
          isRunning: result[STORAGE_KEYS.IS_RUNNING] || false,
          stats: result[STORAGE_KEYS.STATS] || { processed: 0, succeeded: 0, failed: 0 },
        });
      });
    return true;
  }

  return false;
});

Logger.info('Background service worker initialized');
