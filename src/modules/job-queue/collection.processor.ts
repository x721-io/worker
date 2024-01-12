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

interface SyncCollection {
  txCreation: string;
  type: 'ERC721' | 'ERC1155';
}

@Processor(QUEUE_NAME_COLLECTION)
export class CollectionsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(private readonly prisma: PrismaService) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handlePendingCollection() {
    const pendingCollections = await this.prisma.collection.findMany({
      where: {
        OR: [{ status: TX_STATUS.PENDING }, { status: TX_STATUS.FAILED }],
      },
    });
    for (let i = 0; i < pendingCollections.length; i++) {
      // await this.crawlNftInfoToDbSingle(
      //   pendingNfts[i],
      //   pendingNfts[i].collection,
      // );
      await this.getAndSetCollectionStatus(
        pendingCollections[i].txCreationHash,
        pendingCollections[i].type,
      );
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
        console.log(response);
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
      console.log(`Updated status to FAILED for txCreationHash: ${hash}`);
    } catch (prismaError) {
      console.error(
        `Error updating status in database: ${prismaError.message}`,
      );
    }
  }
}
