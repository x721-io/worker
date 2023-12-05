import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions } from 'bull';
import {
  QUEUE_NAME_COLLECTION,
  QUEUE_NAME_IPFS,
  QUEUE_NAME_NFT,
} from 'src/constants/Job.constant';

@Injectable()
export class QueueService {
  private defaultJobOptions: JobOptions = {
    attempts: process.env.MAX_RETRY as unknown as number, // Default number of retry attempts
    backoff: {
      type: 'fixed', // or 'exponential'
      delay: 5000, // Default delay of 5 seconds between retries
    },
    // You can add other default settings here
  };

  constructor(
    @InjectQueue(QUEUE_NAME_COLLECTION) private collectionQueue: Queue,
    @InjectQueue(QUEUE_NAME_NFT) private nftQueue: Queue,
    @InjectQueue(QUEUE_NAME_IPFS) private ipfsQueue: Queue,
  ) {}

  async addJobToQueue(queue: Queue, jobType: string, jobData: any) {
    await queue.add(jobType, jobData, this.defaultJobOptions);
  }

  async addCollectionJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.collectionQueue, jobType, jobData);
  }

  async addNftJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.nftQueue, jobType, jobData);
  }

  async addIPFSJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.ipfsQueue, jobType, jobData);
  }
}
