import { Module } from '@nestjs/common';
import { NftCrawlerService } from './nft-crawler.service';
import { GraphQlcallerService } from '../graph-qlcaller/graph-qlcaller.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  providers: [NftCrawlerService, GraphQlcallerService, PrismaService],
})
export class NftCrawlerModule {}
