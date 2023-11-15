import { Injectable } from '@nestjs/common';
import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import { GetCollectionsQueryVariables, getSdk } from 'src/generated/graphql';
import { QueueService } from './queue.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CollectionsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;
  private readonly maxRetries = 3;

  constructor(private queueService: QueueService, private readonly prisma: PrismaService) {
    this.queueService.getQueue().process('collection', async (job: Job<{ txCreation: string }>, done) => {
      try {
        console.log(typeof job.data)
        const collectionData = await this.checkCollectionStatus(JSON.parse(job.data).txCreation);
        if (collectionData && collectionData.collections.length > 0) {
          // Process collection data here
          done();
        } else if (job.attempts.made < this.maxRetries) {
          // If not found, retry after a delay
          return done(new Error('Collection data not found'));
        } else {
          // Exceeded maximum retries
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
      const a = await this.prisma.user.count()
      console.log('count: ', a);
      return response;
    } catch (err) {
      console.log(err);
    }
  }
}
