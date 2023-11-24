import { Injectable } from '@nestjs/common';
import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import { GetCollections1155Query, GetCollections1155QueryVariables, GetCollections721Query, GetCollections721QueryVariables, getSdk } from 'src/generated/graphql';
import { QueueService } from './queue.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';

interface SyncCollection {
  txCreation: string,
  type: 'ERC721' | 'ERC1155',
}
@Injectable()
export class CollectionsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;
  private readonly maxRetries = 5;

  constructor(private queueService: QueueService, private readonly prisma: PrismaService) {
    this.queueService.getQueue().process('collection', async (job: Job<SyncCollection>, done) => {
      try {
        const obj: SyncCollection = {
          txCreation: JSON.parse(job.data).txCreation,
          type: JSON.parse(job.data).type,
        }
        const collectionData = await this.checkCollectionStatus(obj);
        if (collectionData) {
          // Process collection data here
          done();
        } else if (job.attempts.made < this.maxRetries) {
          // If not found, retry after a delay
          await this.prisma.collection.update({
            where: {
              txCreationHash: obj.txCreation
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          return done(new Error('Collection data not found'));
        } else {
          // Exceeded maximum retries
          await this.prisma.collection.update({
            where: {
              txCreationHash: obj.txCreation,
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          await this.prisma.collection.update({
            where: {
              txCreationHash: obj.txCreation,
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          done(new Error('Exceeded max retries'));
        }
      } catch (error) {
        if (job.attempts.made < this.maxRetries) {
          // Retry on error
          return done(error);
        }
        done(new Error('Failed to process collection'));
      }
    });
  }

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  private async checkCollectionStatus({txCreation, type}: SyncCollection): Promise<boolean> {
    const client = this.getGraphqlClient();
    let isExisted = false;
    const sdk = getSdk(client);
    console.log('let see: ', txCreation)
    if (type === 'ERC721') {
      const variables: GetCollections721QueryVariables = { txCreation: txCreation };
      try {
        const response = await sdk.GetCollections721(variables);
        console.log(response);
        if (response.erc721Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc721Contracts[0].id,
            }
          })
          isExisted = true;
        }
        return isExisted;
      } catch (err) {
        console.log(err);
      }
    } else {
      const variables: GetCollections1155QueryVariables = { txCreation: txCreation };
      try {
        const response = await sdk.GetCollections1155(variables);
        console.log(response);
        if (response.erc1155Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc1155Contracts[0].id,
            }
          })
          isExisted = true;
        }
        return isExisted;
      } catch (err) {
        console.log(err);
      }
    }
  }
}
