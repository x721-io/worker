import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { QueueService } from './queue.service';

@Injectable()
export class RedisSubscriberService implements OnModuleInit {
  private redisClient: Redis;

  constructor(private queueService: QueueService) {
    this.redisClient = new Redis({
      // Redis configuration
      host: '127.0.0.1',
      port: 6379,
      keyPrefix: 'u2u-marketplace'
    });
  }

  onModuleInit() {
      console.log('ah shit')
    this.redisClient.subscribe('collection-channel');
    this.redisClient.on('message', this.handleMessage.bind(this));
  }

  private handleMessage(channel: string, message: string) {
    console.log(channel, message)
    if (channel === 'collection-channel') {
        if (channel === 'collection-channel') {
            const jobData = JSON.parse(message);
            this.queueService.createJob('collection', jobData);
          }
    }
  }
}
