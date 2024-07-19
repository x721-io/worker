import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions } from 'bull';
import {
  QUEUE_COLLECTION_UTILS,
  QUEUE_NAME_COLLECTION,
  QUEUE_NAME_IPFS,
  QUEUE_NAME_NFT,
  QUEUE_NAME_PROJECT,
  QUEUE_NAME_USER,
  QUEUE_NAME_MARKETPLACE_STATUS,
  QUEUE_NAME_QUOTE_TOKEN_ACCEPT,
} from 'src/constants/Job.constant';

@Injectable()
export class QueueService {
  private defaultJobOptions: JobOptions = {
    attempts: process.env.MAX_RETRY as unknown as number, // Default number of retry attempts
    backoff: {
      type: 'fixed', // or 'exponential'
      delay: 5000, // Default delay of 5 seconds between retries
    },
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 10000,
    // You can add other default settings here
  };

  constructor(
    @InjectQueue(QUEUE_NAME_COLLECTION) private collectionQueue: Queue,
    @InjectQueue(QUEUE_COLLECTION_UTILS) private collectionUtilsQueue: Queue,
    @InjectQueue(QUEUE_NAME_NFT) private nftQueue: Queue,
    @InjectQueue(QUEUE_NAME_IPFS) private ipfsQueue: Queue,
    @InjectQueue(QUEUE_NAME_PROJECT) private projectQueue: Queue,
    @InjectQueue(QUEUE_NAME_USER) private userQueue: Queue,
    @InjectQueue(QUEUE_NAME_MARKETPLACE_STATUS) private marketplaceQueue: Queue,
    @InjectQueue(QUEUE_NAME_QUOTE_TOKEN_ACCEPT) private quoteTokenQueue: Queue,
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

  async addProjectJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.projectQueue, jobType, jobData);
  }

  async addUserJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.userQueue, jobType, jobData);
  }

  async addCollectionUtilsJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.collectionUtilsQueue, jobType, jobData);
  }
  async addMarketplaceStatusJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.marketplaceQueue, jobType, jobData);
  }
  async addQuoteTokenAccessJob(jobType: string, jobData: any) {
    await this.addJobToQueue(this.quoteTokenQueue, jobType, jobData);
  }
}
