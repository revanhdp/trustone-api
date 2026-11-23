import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const phc = await hashPassword('correct horse battery');
    expect(phc.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    await expect(verifyPassword('correct horse battery', phc)).resolves.toBe(true);
    await expect(verifyPassword('wrong password!!', phc)).resolves.toBe(false);
  });

  it('uses a random salt per hash', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });

  it('rejects malformed hashes', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
  });
});
