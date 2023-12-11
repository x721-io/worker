import { Controller, Get, Query } from '@nestjs/common';
import { CommonService } from './common.service';

@Controller('common')
export class CommonController {
  constructor(private readonly commonService: CommonService) {}

  @Get('get-ipfs')
  async getIpfs(@Query('hash') hash: string) {
    return await this.commonService.getFromIpfs(hash);
  }
}
