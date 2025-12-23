// Configuration constants

export const DEFAULT_API_URL = 'http://localhost:3000';
export const DEFAULT_POLLING_INTERVAL = 1; // In minutes
export const JOB_TIMEOUT = 120000; // 2 minutes in milliseconds
export const HEARTBEAT_INTERVAL = 5000; // 5 seconds in milliseconds
export const DEFAULT_RETRY_ATTEMPTS = 10; // Number of retry attempts for content script communication
export const DEFAULT_MAX_RETRY_DELAY = 30000; // Maximum delay between retries in milliseconds (30 seconds)

export const STORAGE_KEYS = {
  API_KEY: 'apiKey',
  CLIENT_ID: 'clientId',
  IS_RUNNING: 'isRunning',
  API_URL: 'apiUrl',
  POLLING_INTERVAL: 'pollingInterval',
  RETRY_ATTEMPTS: 'retryAttempts',
  MAX_RETRY_DELAY: 'maxRetryDelay',
  STATS: 'stats',
  LOGS: 'isekai-logs',
  JOB_HISTORY: 'job-history',
} as const;

export const ALARM_NAMES = {
  JOB_POLL: 'job-poll',
} as const;

export const MESSAGE_TYPES = {
  START_JOB: 'START_JOB',
  JOB_SUCCESS: 'JOB_SUCCESS',
  JOB_FAILED: 'JOB_FAILED',
  CAPTURE_SCREENSHOT: 'CAPTURE_SCREENSHOT',
  HEARTBEAT: 'HEARTBEAT',
} as const;
