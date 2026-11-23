import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service.js';

@ApiTags('public: settings')
@Controller('settings')
export class SettingsPublicController {
  constructor(private readonly settings: SettingsService) {}

  /** Company, contact and website texts for the public site (null = not configured yet). */
  @Get('public')
  async getPublic() {
    return { data: await this.settings.getPublic() };
  }
}
