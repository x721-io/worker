import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { QueueService } from './queue.service';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
@Injectable()
export class RedisSubscriberService implements OnModuleInit {
  private redisClient: Redis;

  constructor(private queueService: QueueService) {
    this.redisClient = new Redis({
      // Redis configuration
      host: process.env.REDISDB_HOST,
      port: process.env.REDISDB_PORT as unknown as number,
      keyPrefix: process.env.REDIS_PREFIX,
      password: process.env.REDIS_PASSWORD
    });
  }

  onModuleInit() {
    console.log(process.env.REDISDB_HOST)
      console.log('ah shit')
    this.redisClient.subscribe('collection-channel');
    this.redisClient.subscribe('nft-channel');
    this.redisClient.on('message', this.handleMessage.bind(this));
  }

  private handleMessage(channel: string, message: string) {
    console.log(channel, message)
    if (channel === 'collection-channel') {
        const jobData = JSON.parse(message);
        this.queueService.createJob('collection', jobData);
    }
    if (channel === 'nft-channel') {
        const jobData = JSON.parse(message);
        this.queueService.createJob('nft', jobData);
    }
  }
}
