import { Job, NextJobResponse } from './types';
import { STORAGE_KEYS, DEFAULT_API_URL } from './constants';
import { Logger } from './logger';

/**
 * API Client for communicating with the isekai-core backend
 */
export class ApiClient {
  private apiUrl: string;
  private apiKey: string | null;

  constructor(apiUrl?: string, apiKey?: string) {
    this.apiUrl = apiUrl || DEFAULT_API_URL;
    this.apiKey = apiKey || null;
  }

  /**
   * Initialize API client with settings from storage
   */
  static async fromStorage(): Promise<ApiClient> {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.API_URL,
      STORAGE_KEYS.API_KEY,
    ]);

    const apiUrl = result[STORAGE_KEYS.API_URL] || DEFAULT_API_URL;
    const apiKey = result[STORAGE_KEYS.API_KEY] || null;

    return new ApiClient(apiUrl, apiKey);
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Add API key if available
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const url = `${this.apiUrl}${endpoint}`;
    const method = options.method || 'GET';

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
      });

      Logger.debug(`${method} ${endpoint} → ${response.status}`);

      if (!response.ok) {
        let errorBody;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text().catch(() => 'Request failed');
        }

        const error = typeof errorBody === 'object' ? errorBody : { message: errorBody };
        const errorMessage = error.message || error.error || `HTTP ${response.status}`;

        // Add context for common errors
        if (response.status === 401) {
          throw new Error(
            `Authentication failed: ${errorMessage}. Please check your API key in settings.`
          );
        }
        if (response.status === 403) {
          throw new Error(`Access forbidden: ${errorMessage}`);
        }
        if (response.status === 404) {
          throw new Error(`Not found: ${errorMessage}`);
        }

        throw new Error(errorMessage);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      // Enhance error message for network failures
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const enhancedError = new Error(
          `Network error: Failed to connect to ${this.apiUrl}. Please check your API URL and internet connection.`
        );
        Logger.error(`API request failed: ${endpoint}`, {
          error: enhancedError.message,
          url,
          apiUrl: this.apiUrl,
          originalError: error.message
        });
        throw enhancedError;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      Logger.error(`API request failed: ${endpoint}`, {
        error: message,
        url,
        apiUrl: this.apiUrl,
        errorType: error?.constructor?.name
      });
      throw error;
    }
  }

  /**
   * Get next job from the queue
   */
  async getNextJob(clientId: string): Promise<Job | null> {
    const response = await this.request<NextJobResponse>(
      `/api/sale-queue/next?clientId=${encodeURIComponent(clientId)}`
    );
    return response.item;
  }

  /**
   * Mark job as completed
   */
  async completeJob(jobId: string): Promise<void> {
    await this.request(`/api/sale-queue/${jobId}/complete`, {
      method: 'POST',
    });
  }

  /**
   * Mark job as failed
   */
  async failJob(
    jobId: string,
    errorMessage: string,
    errorDetails?: Record<string, any>
  ): Promise<{ willRetry: boolean }> {
    return this.request(`/api/sale-queue/${jobId}/fail`, {
      method: 'POST',
      body: JSON.stringify({
        errorMessage,
        errorDetails,
      }),
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string }> {
    return this.request('/api/health');
  }

  /**
   * Cleanup stale jobs (manual trigger)
   */
  async cleanupStaleJobs(): Promise<{ cleaned: number; message: string }> {
    return this.request('/api/sale-queue/cleanup', {
      method: 'POST',
    });
  }

  /**
   * Get queue items with optional filters
   */
  async getQueueItems(params?: {
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    page?: number;
    limit?: number;
  }): Promise<{
    items: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const query = queryParams.toString();
    return this.request(`/api/sale-queue${query ? '?' + query : ''}`);
  }

  /**
   * Delete a queue item
   */
  async deleteQueueItem(itemId: string): Promise<void> {
    await this.request(`/api/sale-queue/${itemId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Cancel all pending jobs
   */
  async cancelAllPendingJobs(): Promise<{ cancelled: number }> {
    let cancelled = 0;
    let page = 1;
    const limit = 100;

    while (true) {
      const response = await this.getQueueItems({ status: 'pending', page, limit });

      if (response.items.length === 0) {
        break;
      }

      // Delete each item
      for (const item of response.items) {
        try {
          await this.deleteQueueItem(item.id);
          cancelled++;
        } catch (error) {
          Logger.error(`Failed to delete queue item ${item.id}`, { error });
        }
      }

      // Check if there are more pages
      if (response.items.length < limit) {
        break;
      }

      page++;
    }

    return { cancelled };
  }

  /**
   * Reset stuck jobs by PATCH to pending status
   * Alternative to cleanupStaleJobs when that endpoint fails
   */
  async resetStuckJobsManually(): Promise<{ reset: number }> {
    let reset = 0;
    let page = 1;
    const limit = 100;

    while (true) {
      const response = await this.getQueueItems({ status: 'processing', page, limit });

      if (response.items.length === 0) {
        break;
      }

      // Reset each stuck item to pending
      for (const item of response.items) {
        try {
          await this.request(`/api/sale-queue/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'pending',
            }),
          });
          reset++;
          Logger.info(`Reset stuck job ${item.id} to pending`);
        } catch (error) {
          Logger.error(`Failed to reset stuck job ${item.id}`, { error });
        }
      }

      // Check if there are more pages
      if (response.items.length < limit) {
        break;
      }

      page++;
    }

    return { reset };
  }
}
