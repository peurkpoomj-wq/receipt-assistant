import { messagingApi } from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

function getClient(): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  });
}

function getBlobClient(): messagingApi.MessagingApiBlobClient {
  return new messagingApi.MessagingApiBlobClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  });
}

const RICH_MENU_DEF: messagingApi.RichMenuRequest = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'receipt-assistant-menu',
  chatBarText: '📷 เมนู',
  areas: [
    // Row 1: Report | Budget | My Expenses
    {
      bounds: { x: 0, y: 0, width: 833, height: 421 },
      action: { type: 'message', label: 'รายงาน', text: '/report' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 421 },
      action: { type: 'message', label: 'งบประมาณ', text: '/budget' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 421 },
      action: { type: 'message', label: 'รายการของฉัน', text: '/my' },
    },
    // Row 2: Help | Camera | Camera Roll
    {
      bounds: { x: 0, y: 421, width: 833, height: 422 },
      action: { type: 'message', label: 'ช่วยเหลือ', text: '/help' },
    },
    {
      bounds: { x: 833, y: 421, width: 834, height: 422 },
      action: { type: 'camera', label: 'ถ่ายรูปใบเสร็จ' },
    },
    {
      bounds: { x: 1667, y: 421, width: 833, height: 422 },
      action: { type: 'cameraRoll', label: 'เลือกรูปจากคลัง' },
    },
  ],
};

export async function initRichMenu(): Promise<void> {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    logger.warn('LINE_CHANNEL_ACCESS_TOKEN not set — skipping rich menu init');
    return;
  }

  try {
    const client = getClient();

    // Remove all existing rich menus to avoid stale state
    const existing = await client.getRichMenuList();
    await Promise.all(existing.richmenus.map(m => client.deleteRichMenu(m.richMenuId)));

    const { richMenuId } = await client.createRichMenu(RICH_MENU_DEF);
    logger.info('Rich menu created', { richMenuId });

    // Upload custom image if path is configured
    const imagePath = process.env.RICHMENU_IMAGE_PATH;
    if (imagePath) {
      const absPath = path.resolve(imagePath);
      if (fs.existsSync(absPath)) {
        const imageBuffer = fs.readFileSync(absPath);
        const blob = new Blob([imageBuffer], { type: 'image/png' });
        await getBlobClient().setRichMenuImage(richMenuId, blob);
        logger.info('Rich menu image uploaded from', absPath);
      } else {
        logger.warn('RICHMENU_IMAGE_PATH set but file not found — menu will be text-only', { absPath });
      }
    } else {
      logger.info(
        'Rich menu created without custom image. ' +
        'To add a graphic, set RICHMENU_IMAGE_PATH=<path/to/2500x843.png> and restart.'
      );
    }

    await client.setDefaultRichMenu(richMenuId);
    logger.info('Rich menu activated as default', { richMenuId });
  } catch (err) {
    // Non-fatal: bot still works, just without a rich menu
    logger.warn('Rich menu init failed (non-fatal)', err instanceof Error ? err.message : String(err));
  }
}
