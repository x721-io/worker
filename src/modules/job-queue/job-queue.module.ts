import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RedisSubscriberService } from './redis.service';
import { CollectionsCheckProcessor } from './processor.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { NFTsCheckProcessor } from './nft.processor';
import { IPFSProcessor } from './ipfs.processor';
import { CommonService } from '../common/common.service';

@Module({
  providers: [
    QueueService,
    RedisSubscriberService,
    CollectionsCheckProcessor,
    PrismaService,
    NFTsCheckProcessor,
    IPFSProcessor,
    CommonService,
  ],
})
export class JobQueueModule {}
