// 日志模块
import { state, logBuffer, MAX_LOGS } from './state';

export function addLog (level: string, msg: string): void {
  if (level === 'debug' && !state.config.debug) return;
  logBuffer.push({ time: Date.now(), level, msg });
  if (logBuffer.length > MAX_LOGS) logBuffer.splice(0, logBuffer.length - MAX_LOGS);
}
