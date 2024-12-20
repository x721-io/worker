// import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import {
  GetCollections1155QueryVariables,
  GetCollections721QueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAME_COLLECTION } from 'src/constants/Job.constant';
import { Cron, CronExpression } from '@nestjs/schedule';
import subgraphServiceCommon from '../helper/subgraph-helper.service';
import { RedisSubscriberService } from './redis.service';
import { logger } from 'src/commons';
import { DynamicScheduleService } from '../helper/dynamic-schedule.service';
import { OnModuleInit } from '@nestjs/common';
interface SyncCollection {
  txCreation: string;
  type: 'ERC721' | 'ERC1155';
}

@Processor(QUEUE_NAME_COLLECTION)
export class CollectionsCheckProcessor implements OnModuleInit {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisSubscriberService,
    private dynamicScheduleService: DynamicScheduleService,
  ) {}

  private pendingCollectionJob = 'handlePendingCollectionJob';
  private isCollectionJobRunning = false;

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  onModuleInit() {
    //Initialize the dynamic job with default cron time
    this.dynamicScheduleService.addDynamicCronJob(
      this.pendingCollectionJob,
      CronExpression.EVERY_10_SECONDS,
      this.handlePendingCollection.bind(this),
    );
  }

  // @Cron(CronExpression.EVERY_10_SECONDS)
  async handlePendingCollection() {
    try {
      if (this.isCollectionJobRunning) {
        logger.warn(`Task is already running, skipping execution`);
        return;
      }

      this.isCollectionJobRunning = true; // Đánh dấu task đang chạy

      const batchSize = 100;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const pendingCollections = await this.prisma.collection.findMany({
          where: {
            OR: [{ status: TX_STATUS.PENDING }],
          },
          take: batchSize,
          skip: offset,
        });
        if (pendingCollections?.length > 0) {
          await Promise.allSettled(
            pendingCollections.map(async (collection) => {
              try {
                await this.getAndSetCollectionStatus(
                  collection.txCreationHash,
                  collection.type,
                );
              } catch (error) {
                await this.handleCollectionSyncFailed(
                  collection.txCreationHash,
                );
              }
            }),
          );
          offset += batchSize;
        } else {
          hasMore = false;
        }
        this.dynamicScheduleService.adjustJobSchedule(
          this.pendingCollectionJob,
          pendingCollections.length,
        );
      }
      logger.info(`Sync Collection Pending Successfully`);
    } catch (error) {
      logger.error(
        `Sync data Pending Collection Fail: ${JSON.stringify(error)}`,
      );
    } finally {
      this.isCollectionJobRunning = false; // Đánh dấu task đã kết thúc
    }
  }
  @Process('collection-create')
  private async checkCollectionStatus(
    job: Job<SyncCollection>,
  ): Promise<boolean> {
    const { txCreation, type } = job.data;
    try {
      return await this.getAndSetCollectionStatus(txCreation, type);
    } catch (err) {
      throw new Error(err);
    }
  }

  async getAndSetCollectionStatus(
    txCreation: string,
    type: string,
  ): Promise<boolean> {
    let isExisted = false;
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    if (type === 'ERC721') {
      const variables: GetCollections721QueryVariables = {
        txCreation: txCreation,
      };
      try {
        const response = await sdk.GetCollections721(variables);
        if (response.erc721Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation,
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc721Contracts[0].id,
            },
          });
          isExisted = true;
          return isExisted;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else {
      const variables: GetCollections1155QueryVariables = {
        txCreation: txCreation,
      };
      try {
        const response = await sdk.GetCollections1155(variables);
        if (response.erc1155Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation,
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc1155Contracts[0].id,
            },
          });
          isExisted = true;
          return isExisted;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } catch (err) {
        console.log(err);
        throw err;
      }
    }
  }

  @OnQueueFailed()
  private async onCollectionCreateFail(job: Job<SyncCollection>, error: Error) {
    console.error(`Job failed: ${job.id} with error: ${error.message}`);
    const retry = job.attemptsMade;
    const hash = job.data.txCreation;

    try {
      if (retry >= parseInt(process.env.MAX_RETRY))
        await this.prisma.collection.update({
          where: {
            txCreationHash: hash,
          },
          data: {
            status: TX_STATUS.FAILED,
          },
        });
      logger.info(`Updated status to FAILED for txCreationHash: ${hash}`);
    } catch (prismaError) {
      logger.error(
        `Error updating status in database: ${JSON.stringify(prismaError)}`,
      );
    }
  }
  // @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCountExternalCollection() {
    try {
      const externalCollections = await this.prisma.collection.findMany({
        where: {
          flagExtend: true,
        },
        select: {
          id: true,
          address: true,
        },
      });

      for (const collection of externalCollections) {
        const { totalNftExternal, totalOwnerExternal } =
          await subgraphServiceCommon.getAllCollectionExternal(
            collection.address,
          );
        const key = `External-${collection.address}`;
        this.redisService.set(
          `session:${key}`,
          {
            address: collection.address,
            totalNft: totalNftExternal.toString(),
            totalOwner: totalOwnerExternal.toString(),
          },
          604800,
        );
      }
      logger.info('handleExternalCollection successful');
    } catch (error) {
      logger.error(
        `HandleExternalCollection Fail 10 seconds: ${JSON.stringify(error)}`,
      );
    }
  }

  async handleCollectionSyncFailed(hash: string) {
    try {
      await this.prisma.collection.update({
        where: {
          txCreationHash: hash,
        },
        data: {
          status: TX_STATUS.FAILED,
        },
      });
      logger.info(
        `handleCollectionSync status to FAILED for txCreationHash: ${hash}`,
      );
    } catch (prismaError) {
      logger.error(
        `Error updating status in database: ${JSON.stringify(prismaError)}`,
      );
    }
  }
}
