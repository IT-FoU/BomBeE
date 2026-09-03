export const APP_ROLES = [
  'owner',
  'admin',
  'finance',
  'operations',
  'catalog',
  'support',
  'auditor',
] as const;

export type AppRole = (typeof APP_ROLES)[number];
