import { Module } from '@nestjs/common';
import { NftCrawlerService } from './nft-crawler.service';
import { GraphQlcallerService } from '../graph-qlcaller/graph-qlcaller.service';

@Module({
  providers: [NftCrawlerService, GraphQlcallerService],
})
export class NftCrawlerModule {}
