import { UserProfile, PendingRegistration } from '../types';
import { logger } from '../utils/logger';

const userStore = new Map<string, UserProfile>();
const pendingRegistrations = new Map<string, PendingRegistration>();

const REGISTRATION_TTL = 10 * 60 * 1000; // 10 minutes

// Purge stale registration sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingRegistrations) {
    if (now - val.createdAt > REGISTRATION_TTL) pendingRegistrations.delete(key);
  }
}, 2 * 60 * 1000);

export function isRegistered(userId: string): boolean {
  return userStore.has(userId);
}

export function getUser(userId: string): UserProfile | undefined {
  return userStore.get(userId);
}

export function getUserDisplayName(userId: string): string {
  return userStore.get(userId)?.displayName ?? `ผู้ใช้ ...${userId.slice(-4)}`;
}

export function getUserDepartment(userId: string): string {
  return userStore.get(userId)?.department ?? 'ทั่วไป';
}

export function registerUser(
  userId: string,
  displayName: string,
  department: string
): UserProfile {
  const profile: UserProfile = {
    userId,
    displayName: displayName.trim(),
    department: department.trim(),
    registeredAt: new Date().toISOString(),
  };
  userStore.set(userId, profile);
  pendingRegistrations.delete(userId);
  logger.info('User registered', { userId, displayName, department });
  return profile;
}

export function startRegistration(userId: string): void {
  pendingRegistrations.set(userId, { step: 'awaiting_name', createdAt: Date.now() });
}

export function getPendingRegistration(userId: string): PendingRegistration | undefined {
  return pendingRegistrations.get(userId);
}

export function advanceRegistration(userId: string, displayName: string): void {
  pendingRegistrations.set(userId, {
    step: 'awaiting_department',
    displayName,
    createdAt: Date.now(),
  });
}

export function cancelRegistration(userId: string): void {
  pendingRegistrations.delete(userId);
}
