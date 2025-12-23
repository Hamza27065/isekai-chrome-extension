import { LogLevel, LogEntry } from './types';

/**
 * Centralized logger for the extension
 * Logs are stored in chrome.storage.local and can be viewed in the console page
 */
export class Logger {
  private static readonly MAX_LOGS = 1000;
  private static readonly STORAGE_KEY = 'isekai-logs';

  /**
   * Add a log entry
   */
  static async log(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    jobId?: string
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      jobId,
    };

    try {
      // Get existing logs
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      const logs: LogEntry[] = result[this.STORAGE_KEY] || [];

      // Add new entry and rotate if needed
      const updatedLogs = [...logs, entry].slice(-this.MAX_LOGS);

      // Save to storage (triggers chrome.storage.onChanged for console page)
      await chrome.storage.local.set({ [this.STORAGE_KEY]: updatedLogs });

      // Also log to console for debugging
      const prefix = `[${new Date(entry.timestamp).toLocaleTimeString()}] ${level}`;
      const style = this.getConsoleStyle(level);
      console.log(`%c${prefix}`, style, message, context || '');
    } catch (error) {
      console.error('Failed to save log:', error);
    }
  }

  /**
   * Log info message
   */
  static info(message: string, context?: Record<string, any>, jobId?: string): Promise<void> {
    return this.log(LogLevel.INFO, message, context, jobId);
  }

  /**
   * Log success message
   */
  static success(message: string, context?: Record<string, any>, jobId?: string): Promise<void> {
    return this.log(LogLevel.SUCCESS, message, context, jobId);
  }

  /**
   * Log error message
   */
  static error(message: string, context?: Record<string, any>, jobId?: string): Promise<void> {
    return this.log(LogLevel.ERROR, message, context, jobId);
  }

  /**
   * Log warning message
   */
  static warning(message: string, context?: Record<string, any>, jobId?: string): Promise<void> {
    return this.log(LogLevel.WARNING, message, context, jobId);
  }

  /**
   * Log debug message
   */
  static debug(message: string, context?: Record<string, any>, jobId?: string): Promise<void> {
    return this.log(LogLevel.DEBUG, message, context, jobId);
  }

  /**
   * Get all logs from storage
   */
  static async getLogs(): Promise<LogEntry[]> {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] || [];
  }

  /**
   * Clear all logs
   */
  static async clearLogs(): Promise<void> {
    await chrome.storage.local.remove(this.STORAGE_KEY);
    await this.info('Logs cleared');
  }

  /**
   * Get console style for log level
   */
  private static getConsoleStyle(level: LogLevel): string {
    const styles: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: 'color: #888; font-weight: normal',
      [LogLevel.INFO]: 'color: #5bc0de; font-weight: normal',
      [LogLevel.SUCCESS]: 'color: #00e59b; font-weight: bold',
      [LogLevel.WARNING]: 'color: #f0ad4e; font-weight: bold',
      [LogLevel.ERROR]: 'color: #d9534f; font-weight: bold',
    };
    return styles[level];
  }
}
