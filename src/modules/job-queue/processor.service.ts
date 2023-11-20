import { Injectable } from '@nestjs/common';
import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import { GetCollectionsQueryVariables, getSdk } from 'src/generated/graphql';
import { QueueService } from './queue.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';

@Injectable()
export class CollectionsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;
  private readonly maxRetries = 5;

  constructor(private queueService: QueueService, private readonly prisma: PrismaService) {
    this.queueService.getQueue().process('collection', async (job: Job<{ txCreation: string }>, done) => {
      try {
        const hash = JSON.parse(job.data).txCreation
        const collectionData = await this.checkCollectionStatus(hash);
        if (collectionData && collectionData.collections.length > 0) {
          // Process collection data here
          done();
        } else if (job.attempts.made < this.maxRetries) {
          // If not found, retry after a delay
          await this.prisma.collection.update({
            where: {
              txCreationHash: hash
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
              txCreationHash: hash
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          await this.prisma.collection.update({
            where: {
              txCreationHash: hash
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

  private async checkCollectionStatus(hash: string) {
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    console.log('let see: ', hash)
    const variables: GetCollectionsQueryVariables = { txCreation: hash };
    try {
      const response = await sdk.GetCollections(variables);
      console.log(response);
      if (response.collections.length > 0) {
        await this.prisma.collection.update({
          where: {
            txCreationHash: hash
          },
          data: {
            status: TX_STATUS.SUCCESS,
            address: response.collections[0].id,
          }
        })
      }
      return response;
    } catch (err) {
      console.log(err);
    }
  }
}
