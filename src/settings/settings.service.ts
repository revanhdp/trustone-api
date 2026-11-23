import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository.js';

/** Settings that are safe to expose on the public website. */
export const PUBLIC_SETTING_KEYS = [
  'company.name',
  'company.about',
  'contact.whatsapp_number',
  'contact.phone',
  'contact.email',
  'contact.address',
  'contact.business_hours',
  'contact.is_dummy',
  'site.hero_title',
  'site.hero_subtitle',
  'site.footer_text',
  'catalog.show_prices',
] as const;

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  async getPublic(): Promise<Record<(typeof PUBLIC_SETTING_KEYS)[number], unknown>> {
    const values = await this.repo.getMany(PUBLIC_SETTING_KEYS);
    return Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, values[k] ?? null])) as Record<
      (typeof PUBLIC_SETTING_KEYS)[number],
      unknown
    >;
  }
}
