import cron from 'node-cron';
import { messagingApi } from '@line/bot-sdk';
import { getMonthSummary, getTodaySummary } from './sheets.service';
import { buildDailyFlashText } from './report.service';
import { logger } from '../utils/logger';

function getClient(): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  });
}

function getRecipients(): string[] {
  const userIds = (process.env.ADMIN_LINE_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const groupId = process.env.REPORT_GROUP_ID?.trim();
  return groupId ? [groupId, ...userIds] : userIds;
}

async function sendDailyFlash(): Promise<void> {
  const recipients = getRecipients();
  if (recipients.length === 0) {
    logger.debug('No recipients configured for daily flash — set ADMIN_LINE_USER_IDS or REPORT_GROUP_ID');
    return;
  }

  try {
    const [monthSummary, todaySummary] = await Promise.all([
      getMonthSummary(),
      getTodaySummary(),
    ]);

    const text = buildDailyFlashText(monthSummary, todaySummary);
    const client = getClient();

    await Promise.all(
      recipients.map(to => client.pushMessage({ to, messages: [{ type: 'text', text }] }))
    );
    logger.info('Daily flash sent', { recipients });
  } catch (err) {
    logger.error('Daily flash error', err instanceof Error ? err.message : String(err));
  }
}

export function initScheduler(): void {
  const tz = process.env.REPORT_TIMEZONE ?? 'Asia/Bangkok';
  const dailyTime = process.env.DAILY_REPORT_TIME ?? '18:00';
  const [hourStr, minStr] = dailyTime.split(':');
  const hour = hourStr ?? '18';
  const min = minStr ?? '0';

  // Weekdays only (Mon–Fri)
  cron.schedule(`${min} ${hour} * * 1-5`, sendDailyFlash, { timezone: tz });

  logger.info(`Scheduler initialised — daily flash at ${dailyTime} ${tz} (Mon–Fri)`);
}
