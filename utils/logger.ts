import { createLogger, format, transports, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';

// Allow override via env, fallback to "logs" inside app
const LOG_DIR = process.env.LOG_DIR || 'logs';
const DISABLE_FILE_LOGGING = process.env.DISABLE_FILE_LOGGING === 'true';

// Ensure log directory exists (best-effort)
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (e) {
  // Don't crash the app if we can't create logs dir
  // Console logging will still work.
  console.error('Failed to create log directory:', LOG_DIR, e);
}

// Define the file transport for daily log rotation (optional)
const fileTransports: any[] = [];

if (!DISABLE_FILE_LOGGING) {
  const dailyRotateFileTransport = new DailyRotateFile({
    dirname: LOG_DIR, // 👈 use directory, not hard-coded 'logs/...'
    filename: 'application-%DATE%.log',
    datePattern: 'YYYY-MM-DD', // Daily log files
    zippedArchive: true,       // Compress the log files
    maxSize: '20m',            // Max size of a single log file
    maxFiles: '14d',           // Keep logs for the last 14 days
    format: format.combine(
      format.timestamp(),
      format.json()
    ),
  });

  fileTransports.push(dailyRotateFileTransport);
}

// Create the logger instance
const logger: Logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      ),
    }),
    ...fileTransports,
  ],
});

export default logger;
