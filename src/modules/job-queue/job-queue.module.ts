import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RedisSubscriberService } from './redis.service';
import { CollectionsCheckProcessor } from './processor.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  providers: [QueueService, RedisSubscriberService, CollectionsCheckProcessor, PrismaService],
})
export class JobQueueModule {}
