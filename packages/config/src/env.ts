import { z } from 'zod';

export const AppEnv = z.enum(['local', 'staging', 'production']);
export type AppEnvName = z.infer<typeof AppEnv>;

const productionHostPatterns = [
  /\.supabase\.co$/i,
  /prod/i,
  /production/i,
];

function looksLikeProductionHost(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return productionHostPatterns.some((pattern) => pattern.test(host));
  } catch {
    return productionHostPatterns.some((pattern) => pattern.test(value));
  }
}

export const envSchema = z
  .object({
    APP_ENV: AppEnv,
    APP_NAME: z.string().min(1).default('BomBee Market'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    PUBLIC_API_URL: z.string().url(),
    PUBLIC_CUSTOMER_URL: z.string().url(),
    PUBLIC_BACKOFFICE_URL: z.string().url(),
    DATABASE_URL: z.string().min(1).optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    EGO_POS_ENABLED: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    DISPLAY_TIMEZONE: z.string().default('Asia/Vientiane'),
    CURRENCY_CODE: z.literal('LAK').default('LAK'),
  })
  .superRefine((env, ctx) => {
    if (env.EGO_POS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['EGO_POS_ENABLED'],
        message: 'EGO POS must remain disabled in Phase 1',
      });
    }

    if (env.APP_ENV !== 'production') {
      const candidates = [env.SUPABASE_URL, env.PUBLIC_API_URL, env.DATABASE_URL].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );

      for (const candidate of candidates) {
        if (looksLikeProductionHost(candidate) && /prod|production/i.test(candidate)) {
          ctx.addIssue({
            code: 'custom',
            message: `Local/Staging must not point at Production resources: ${candidate}`,
          });
        }
      }

      if (env.SUPABASE_SERVICE_ROLE_KEY && /service_role_prod/i.test(env.SUPABASE_SERVICE_ROLE_KEY)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SUPABASE_SERVICE_ROLE_KEY'],
          message: 'Local/Staging must not use Production service-role keys',
        });
      }
    }

    if (env.APP_ENV === 'production' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: 'Production APP_ENV requires NODE_ENV=production',
      });
    }
  });

export type BombeeEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): BombeeEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

export function loadEnv(
  raw: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): BombeeEnv {
  return parseEnv(raw);
}
