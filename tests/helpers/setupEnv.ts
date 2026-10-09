// Runs before every test file (vitest `setupFiles`): points the server at a private temp directory BEFORE any
// server module is imported, so static imports in tests can never touch the repo's data/ or logs/ folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crosslister-test-'));
process.env.CROSSLISTER_TEST_ROOT = root;
process.env.CROSSLISTER_DATA_DIR = path.join(root, 'data');
process.env.CROSSLISTER_PROFILES_DIR = path.join(root, 'profiles');
process.env.CROSSLISTER_LOGS_DIR = path.join(root, 'logs');
process.env.CROSSLISTER_SECRETS_BACKEND = 'file';
process.env.CROSSLISTER_QUIET = '1';
// eBay credentials for tests (all HTTP is mocked; nothing real is ever contacted).
process.env.EBAY_ENV = 'production';
process.env.EBAY_CLIENT_ID = 'test-client-id';
process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
process.env.EBAY_RUNAME = 'Test-RuName-123';
