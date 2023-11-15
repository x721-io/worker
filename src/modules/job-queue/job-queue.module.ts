import { Module } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';
import { JobQueueController } from './job-queue.controller';
import { BullModule } from '@nestjs/bull';

@Module({
  controllers: [JobQueueController],
  providers: [JobQueueService],
  imports: [
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
      prefix: 'u2u-marketplace'
    })
  ]
})
export class JobQueueModule {}
