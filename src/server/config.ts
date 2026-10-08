import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 4317),
  isProd: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(process.env.CROSSLISTER_DATA_DIR ?? './data'),
  profilesDir: path.resolve(process.env.CROSSLISTER_PROFILES_DIR ?? './browser-profiles'),
  logsDir: path.resolve(process.env.CROSSLISTER_LOGS_DIR ?? './logs'),
  secretsBackend: (process.env.CROSSLISTER_SECRETS_BACKEND ??
    (process.platform === 'darwin' ? 'keychain' : 'file')) as 'keychain' | 'file',
  ebay: {
    env: (process.env.EBAY_ENV ?? 'production') as 'production' | 'sandbox',
    clientId: process.env.EBAY_CLIENT_ID ?? '',
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? '',
    ruName: process.env.EBAY_RUNAME ?? '',
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  openaiCompatibleApiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
};
