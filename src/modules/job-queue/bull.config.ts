import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import {
  QUEUE_COLLECTION_UTILS,
  QUEUE_NAME_COLLECTION,
  QUEUE_NAME_IPFS,
  QUEUE_NAME_NFT,
  QUEUE_NAME_PROJECT,
  QUEUE_NAME_TIMER,
  QUEUE_NAME_USER,
  QUEUE_NAME_MARKETPLACE_STATUS,
  QUEUE_NAME_QUOTE_TOKEN_ACCEPT,
} from '../../constants/Job.constant';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDISDB_HOST,
        port: parseInt(process.env.REDISDB_PORT),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    BullModule.registerQueue(
      {
        name: QUEUE_NAME_COLLECTION,
      },
      { name: QUEUE_NAME_NFT },
      { name: QUEUE_NAME_IPFS },
      { name: QUEUE_NAME_PROJECT },
      { name: QUEUE_NAME_TIMER },
      { name: QUEUE_NAME_USER },
      { name: QUEUE_COLLECTION_UTILS },
      { name: QUEUE_NAME_MARKETPLACE_STATUS },
      {
        name: QUEUE_NAME_QUOTE_TOKEN_ACCEPT,
      },
    ),
  ],
  exports: [BullModule],
})
export class BullConfigModule {}
