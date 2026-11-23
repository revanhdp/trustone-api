import { validateEnv } from './env.validation.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  STORAGE_ENDPOINT: 'localhost',
  STORAGE_ACCESS_KEY: 'key',
  STORAGE_SECRET_KEY: 'secret',
  STORAGE_PUBLIC_BUCKET: 'pub',
  STORAGE_PRIVATE_BUCKET: 'priv',
};

describe('validateEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = validateEnv({ ...base, API_PORT: '4100', STORAGE_USE_SSL: 'true' });
    expect(env.API_PORT).toBe(4100);
    expect(env.STORAGE_USE_SSL).toBe(true);
    expect(env.STORAGE_AUTO_CREATE_BUCKETS).toBe(false);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails fast when a required variable is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
