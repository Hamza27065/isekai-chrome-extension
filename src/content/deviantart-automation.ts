/**
 * Content script for DeviantArt automation
 * This script runs on all DeviantArt pages and performs automated sales
 */

import { Job, MessageType } from '../shared/types';
import { Logger } from '../shared/logger';

// Selectors for DeviantArt UI elements
const SELECTORS = {
  PRICE_INPUT: 'input[name="purchase_price"]',
  ACCEPT_OFFERS_CHECKBOX: 'input[name="sell_as_offer"]',
  // Multiple possible login indicators
  USER_INDICATORS: [
    '[data-hook="user_link"]',
    '[data-hook="user_menu"]',
    'a[href*="/notifications"]',
    'button[aria-label="Account"]',
    'a[aria-label*="Profile"]',
    '[class*="user-menu"]',
    '[class*="logged-in"]',
  ],
} as const;

/**
 * Helper function to wait for an element to appear in the DOM
 */
function waitForElement<T extends Element = Element>(
  selector: string,
  timeout: number = 15000
): Promise<T> {
  return new Promise((resolve, reject) => {

    // Check if element already exists
    const existingElement = document.querySelector<T>(selector);
    if (existingElement) {
      resolve(existingElement);
      return;
    }

    // Use MutationObserver to watch for element
    const observer = new MutationObserver(() => {
      const element = document.querySelector<T>(selector);
      if (element) {
        observer.disconnect();
        clearTimeout(timeoutId);
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Find button containing specific text
 */
function findButtonByText(textContent: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  return (
    buttons.find((btn) => {
      const text = btn.textContent || '';
      return text.includes(textContent);
    }) || null
  );
}

/**
 * Helper to simulate delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if user is logged into DeviantArt
 */
async function isLoggedIn(): Promise<boolean> {
  // Try multiple possible login indicators
  for (const selector of SELECTORS.USER_INDICATORS) {
    try {
      await waitForElement(selector, 5000);
      Logger.debug(`Login detected via selector: ${selector}`);
      return true;
    } catch {
      // Try next selector
      continue;
    }
  }

  // Also check if we can find the Sell Deviation button (only visible when logged in)
  try {
    await delay(2000);
    const sellButton = findButtonByText('Sell Deviation');
    if (sellButton) {
      Logger.debug('Login detected via Sell Deviation button presence');
      return true;
    }
  } catch {
    // Continue to return false
  }

  return false;
}

/**
 * Main automation function - Sets deviation as exclusive sale
 */
async function automateExclusiveSale(job: Job): Promise<void> {
  const jobId = job.id;

  Logger.info(`Starting automation for: ${job.deviation.title}`, {}, jobId);

  // Check if logged in
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    throw new Error('User not logged into DeviantArt. Please log in and try again.');
  }

  Logger.info('User is logged in - proceeding with automation', {}, jobId);

  // Step 1: Click "Sell Deviation" button
  Logger.info('Waiting for "Sell Deviation" button', {}, jobId);
  await delay(1000); // Wait for page to stabilize

  const sellButton = await new Promise<HTMLButtonElement>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sell Deviation button not found'));
    }, 15000);

    let interval: ReturnType<typeof setInterval>;

    const checkForButton = () => {
      const button = findButtonByText('Sell Deviation');
      if (button) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(button);
      }
    };

    checkForButton();
    interval = setInterval(checkForButton, 500);
  });

  Logger.info('Clicking "Sell Deviation" button', {}, jobId);
  sellButton.click();
  await delay(1000); // Wait for modal animation

  // Step 2: Click "Get Started" button for Exclusive option
  Logger.info('Waiting for "Get Started" button', {}, jobId);
  const getStartedButton = await new Promise<HTMLButtonElement>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Get Started button not found'));
    }, 10000);

    let interval: ReturnType<typeof setInterval>;

    const checkForButton = () => {
      const button = findButtonByText('Get Started');
      if (button) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(button);
      }
    };

    checkForButton();
    interval = setInterval(checkForButton, 500);
  });

  Logger.info('Clicking "Get Started" button', {}, jobId);
  getStartedButton.click();
  await delay(2000); // Wait for form to load

  // Step 3: Fill price input
  Logger.info('Waiting for price input field', {}, jobId);
  const priceInput = await waitForElement<HTMLInputElement>(SELECTORS.PRICE_INPUT, 10000);

  // Wait for input to be interactable
  await delay(500);

  // Convert cents to dollars (no decimals)
  const priceInDollars = Math.round(job.price / 100).toString();
  Logger.info(`Setting price to: $${priceInDollars}`, {}, jobId);

  // Focus and clear existing value
  priceInput.focus();
  await delay(200);
  priceInput.value = '';
  priceInput.dispatchEvent(new Event('input', { bubbles: true }));

  // Set the price
  priceInput.value = priceInDollars;
  priceInput.dispatchEvent(new Event('input', { bubbles: true }));
  priceInput.dispatchEvent(new Event('change', { bubbles: true }));
  priceInput.dispatchEvent(new Event('blur', { bubbles: true }));

  await delay(500);

  // Verify value was set
  if (priceInput.value !== priceInDollars) {
    Logger.warning(`Price verification failed. Expected: ${priceInDollars}, Got: ${priceInput.value}`, {}, jobId);
  }

  Logger.info('Price set successfully', {}, jobId);

  // Step 4: Uncheck "Accept offers" checkbox (non-critical)
  try {
    const checkbox = await waitForElement<HTMLInputElement>(
      SELECTORS.ACCEPT_OFFERS_CHECKBOX,
      5000
    );

    if (checkbox.checked) {
      Logger.info('Unchecking "Accept offers" checkbox', {}, jobId);
      checkbox.click();
      await delay(300);
    }
  } catch (_error) {
    Logger.warning('Could not uncheck "Accept offers" checkbox (non-critical)', {}, jobId);
  }

  // Step 5: Click "Sell Exclusive" button
  Logger.info('Waiting for "Sell Exclusive" button', {}, jobId);
  await delay(1000);

  const sellExclusiveButton = await new Promise<HTMLButtonElement>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sell Exclusive button not found'));
    }, 10000);

    let interval: ReturnType<typeof setInterval>;

    const checkForButton = () => {
      const button = findButtonByText('Sell Exclusive');
      if (button) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(button);
      }
    };

    checkForButton();
    interval = setInterval(checkForButton, 500);
  });

  Logger.info('Clicking "Sell Exclusive" button', {}, jobId);
  sellExclusiveButton.click();
  await delay(2000);

  // Step 6: Wait for success confirmation
  Logger.info('Waiting for success confirmation', {}, jobId);

  const successFound = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 15000);

    let interval: ReturnType<typeof setInterval>;

    const checkForSuccess = () => {
      // Check for success message
      const elements = Array.from(document.querySelectorAll('*'));
      const hasSuccessMessage = elements.some((el) =>
        el.textContent?.includes('Your Exclusive is officially on sale!')
      );

      if (hasSuccessMessage) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(true);
        return;
      }

      // Check for "Maybe Later" or "Boost Now" buttons (also indicates success)
      const hasMaybeLater = findButtonByText('Maybe Later') !== null;
      const hasBoostNow = findButtonByText('Boost Now') !== null;

      if (hasMaybeLater || hasBoostNow) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(true);
      }
    };

    checkForSuccess();
    interval = setInterval(checkForSuccess, 500);
  });

  if (!successFound) {
    throw new Error('Success confirmation not found - sale may have failed');
  }

  Logger.success(`Successfully set exclusive sale for: ${job.deviation.title}`, {}, jobId);
}

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  if (message.type === 'START_JOB' && message.job) {
    const job = message.job;

    Logger.info(`Received job: ${job.deviation.title}`, { jobId: job.id });

    // Run automation asynchronously
    automateExclusiveSale(job)
      .then(() => {
        // Report success to background
        chrome.runtime.sendMessage({
          type: 'JOB_SUCCESS',
          jobId: job.id,
        } as MessageType);
      })
      .catch((error) => {
        // Report failure to background
        Logger.error(`Automation failed: ${error.message}`, { error: error.stack }, job.id);
        chrome.runtime.sendMessage({
          type: 'JOB_FAILED',
          jobId: job.id,
          error: error.message,
        } as MessageType);
      });

    // Send response immediately (required for async message handling)
    sendResponse({ received: true });
    return true; // Keep message channel open for async response
  }
});

Logger.info('DeviantArt automation content script loaded');
