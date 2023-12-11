import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RedisSubscriberService } from './redis.service';
import { CollectionsCheckProcessor } from './collection.processor';
import { PrismaService } from 'src/prisma/prisma.service';
import { NFTsCheckProcessor } from './nft.processor';
import { IPFSProcessor } from './ipfs.processor';
import { CommonService } from '../common/common.service';
import { BullConfigModule } from './bull.config';
import { NftCrawlerService } from '../nft-crawler/nft-crawler.service';
import { GraphQlcallerService } from '../graph-qlcaller/graph-qlcaller.service';

@Module({
  providers: [
    QueueService,
    RedisSubscriberService,
    CollectionsCheckProcessor,
    PrismaService,
    NFTsCheckProcessor,
    IPFSProcessor,
    CommonService,
    NftCrawlerService,
    GraphQlcallerService,
  ],
  imports: [BullConfigModule],
})
export class JobQueueModule {}
