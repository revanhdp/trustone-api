/**
 * Creates an admin user, or resets the password of an existing one.
 *
 *   pnpm admin:create                         (interactive prompts)
 *   ADMIN_EMAIL=.. ADMIN_NAME=.. ADMIN_PASSWORD=.. pnpm admin:create
 *   pnpm admin:create -- --reset-password     (existing user)
 *
 * The password is never printed or logged.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../auth/password.js';
import { UsersRepository } from '../users/users.repository.js';
import { CliModule } from './cli.module.js';

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) =>
        write(s.startsWith(question) ? s : '');
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset-password');
  const email = process.env.ADMIN_EMAIL ?? (await ask('Email admin: '));
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Email tidak valid');

  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    const users = app.get(UsersRepository);
    const existing = await users.findByEmail(email);
    if (existing && !reset) throw new Error('Email sudah terdaftar. Pakai --reset-password untuk mengganti password.');
    if (!existing && reset) throw new Error('User tidak ditemukan');

    const name = existing?.name ?? process.env.ADMIN_NAME ?? (await ask('Nama: '));
    if (!name) throw new Error('Nama wajib diisi');

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      password = await ask(`Password (min. ${PASSWORD_MIN_LENGTH} karakter): `, true);
      const confirm = await ask('Ulangi password: ', true);
      if (password !== confirm) throw new Error('Password tidak sama');
    }
    if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`Password minimal ${PASSWORD_MIN_LENGTH} karakter`);

    const hash = await hashPassword(password);
    if (existing) {
      await users.updatePassword(existing.id, hash);
      console.log(`Password untuk ${email} sudah diganti.`);
    } else {
      await users.create({ name, email, passwordHash: hash, role: 'admin' });
      console.log(`Admin ${email} berhasil dibuat.`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'create-admin');
  process.exitCode = 1;
});
