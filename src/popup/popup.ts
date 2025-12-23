/**
 * Popup UI logic for the toolbar widget
 */

import { STORAGE_KEYS } from '../shared/constants';
import { Stats } from '../shared/types';
import { ApiClient } from '../shared/api-client';
import { Logger } from '../shared/logger';
import { createIcons, Play, StopCircle, Terminal, AlertCircle } from 'lucide';

// UI Elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const apiStatusIndicator = document.getElementById('api-status-indicator')!;
const apiStatusText = document.getElementById('api-status-text')!;
const statsSection = document.getElementById('stats-section')!;
const statProcessed = document.getElementById('stat-processed')!;
const statSucceeded = document.getElementById('stat-succeeded')!;
const statFailed = document.getElementById('stat-failed')!;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const toggleBtnText = document.getElementById('toggle-btn-text')!;
const iconPlay = toggleBtn.querySelector('.icon-play') as HTMLElement;
const iconStop = toggleBtn.querySelector('.icon-stop') as HTMLElement;
const consoleBtn = document.getElementById('console-btn')!;
const configBanner = document.getElementById('config-banner')!;

/**
 * Load and display current status
 */
async function loadStatus(): Promise<void> {
  try {
    // Get status from storage
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.IS_RUNNING,
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_URL,
      STORAGE_KEYS.STATS,
    ]);

    const isRunning = result[STORAGE_KEYS.IS_RUNNING] || false;
    const apiKey = result[STORAGE_KEYS.API_KEY];
    const apiUrl = result[STORAGE_KEYS.API_URL];
    const stats: Stats = result[STORAGE_KEYS.STATS] || {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    // Update status indicator
    updateStatusIndicator(isRunning, stats);

    // Update stats section
    if (apiKey && apiUrl) {
      statsSection.style.display = 'flex';
      statProcessed.textContent = stats.processed.toString();
      statSucceeded.textContent = stats.succeeded.toString();
      statFailed.textContent = stats.failed.toString();
    } else {
      statsSection.style.display = 'none';
    }

    // Show config banner if not configured
    if (!apiKey || !apiUrl) {
      configBanner.style.display = 'flex';
      toggleBtn.disabled = true;
    } else {
      configBanner.style.display = 'none';
      toggleBtn.disabled = false;
    }

    // Update toggle button
    if (isRunning) {
      toggleBtnText.textContent = 'Stop';
      iconPlay.style.display = 'none';
      iconStop.style.display = 'block';
      toggleBtn.classList.remove('btn-primary');
      toggleBtn.classList.add('btn-secondary');
    } else {
      toggleBtnText.textContent = 'Start';
      iconPlay.style.display = 'block';
      iconStop.style.display = 'none';
      toggleBtn.classList.remove('btn-secondary');
      toggleBtn.classList.add('btn-primary');
    }

    // Re-render icons after toggling visibility
    createIcons({
      icons: { Play, StopCircle, Terminal, AlertCircle }
    });
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

/**
 * Update status indicator
 */
function updateStatusIndicator(isRunning: boolean, stats: Stats): void {
  // Remove all status classes
  statusIndicator.classList.remove('active', 'processing', 'stopped');

  if (!isRunning) {
    statusIndicator.classList.add('stopped');
    statusText.textContent = 'STOPPED';
  } else if (stats.currentJob) {
    statusIndicator.classList.add('processing');
    statusText.textContent = 'PROCESSING';
  } else {
    statusIndicator.classList.add('active');
    statusText.textContent = 'ACTIVE';
  }
}

/**
 * Check API health
 */
async function checkApiHealth(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_URL,
    ]);

    if (!result[STORAGE_KEYS.API_KEY] || !result[STORAGE_KEYS.API_URL]) {
      apiStatusIndicator.classList.remove('active', 'processing');
      apiStatusIndicator.classList.add('stopped');
      apiStatusText.textContent = 'NOT CONFIGURED';
      return;
    }

    const client = await ApiClient.fromStorage();
    const health = await client.healthCheck();

    if (health.status === 'healthy') {
      apiStatusIndicator.classList.remove('stopped', 'processing');
      apiStatusIndicator.classList.add('active');
      apiStatusText.textContent = 'API HEALTHY';
    } else {
      apiStatusIndicator.classList.remove('active', 'stopped');
      apiStatusIndicator.classList.add('processing');
      apiStatusText.textContent = 'API DEGRADED';
    }
  } catch (_error) {
    apiStatusIndicator.classList.remove('active', 'processing');
    apiStatusIndicator.classList.add('stopped');
    apiStatusText.textContent = 'API UNREACHABLE';
  }
}

/**
 * Toggle polling (start/stop)
 */
async function togglePolling(): Promise<void> {
  try {
    toggleBtn.disabled = true;

    const result = await chrome.storage.local.get(STORAGE_KEYS.IS_RUNNING);
    const isRunning = result[STORAGE_KEYS.IS_RUNNING] || false;

    if (isRunning) {
      // Stop polling
      const response = await chrome.runtime.sendMessage({ action: 'STOP_POLLING' });
      if (!response.success) {
        throw new Error(response.error || 'Failed to stop polling');
      }
      showFeedback('Polling stopped', true);
    } else {
      // Start polling
      showFeedback('Starting polling...', true);
      const response = await chrome.runtime.sendMessage({ action: 'START_POLLING' });
      if (!response.success) {
        throw new Error(response.error || 'Failed to start polling');
      }
      showFeedback('Polling started successfully', true);
    }

    // Refresh UI
    await loadStatus();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to toggle polling:', error);
    await Logger.error('Failed to toggle polling from popup', { error: errorMessage });
    showFeedback(`Failed: ${errorMessage}`, false);

    // Refresh status to ensure UI is in sync
    await loadStatus();
  } finally {
    toggleBtn.disabled = false;
  }
}


/**
 * Show feedback message
 */
function showFeedback(message: string, isSuccess: boolean): void {
  // Remove existing feedback
  const existing = document.querySelector('.feedback-message');
  if (existing) {
    existing.remove();
  }

  // Create new feedback element
  const feedback = document.createElement('div');
  feedback.className = `feedback-message ${isSuccess ? 'success' : 'error'}`;
  feedback.textContent = message;

  // Insert at top of container
  const container = document.querySelector('.popup-container')!;
  container.insertBefore(feedback, container.firstChild);

  // Remove after 3 seconds
  setTimeout(() => {
    feedback.remove();
  }, 3000);
}

/**
 * Open console page
 */
function openConsole(): void {
  chrome.runtime.openOptionsPage();
}

/**
 * Listen for storage changes to update UI in real-time
 */
chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'local') {
    loadStatus();
  }
});

// Event listeners
toggleBtn.addEventListener('click', togglePolling);
consoleBtn.addEventListener('click', openConsole);

// Initial load
loadStatus();
checkApiHealth();

// Initialize Lucide icons (render all icons including both play and stop)
createIcons({
  icons: {
    Play,
    StopCircle,
    Terminal,
    AlertCircle,
  },
  attrs: {
    'stroke-width': 2,
  }
});

// Refresh every 10 seconds (reduced from 5 for less API load)
// Popup is only visible when user opens it, so this is fine
setInterval(loadStatus, 10000);

// Check API health every 60 seconds
setInterval(checkApiHealth, 60000);
