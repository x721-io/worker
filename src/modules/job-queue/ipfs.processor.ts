import { Injectable } from '@nestjs/common';
import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import {} from 'src/generated/graphql';
import { QueueService } from './queue.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';
import { CommonService } from '../common/common.service';

@Injectable()
export class IPFSProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;
  private readonly maxRetries = 5;

  constructor(
    private queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly common: CommonService,
  ) {
    this.queueService.getQueue().process(
      'ipfs',
      async (
        job: Job<{
          collectionAddress: string;
          tokenId: string;
          ipfsUrl: string;
        }>,
        done,
      ) => {
        try {
          const { collectionAddress, tokenId, ipfsUrl } = JSON.parse(job.data);
          const isUpdated = await this.updateIPFS(
            collectionAddress,
            tokenId,
            ipfsUrl,
          );
          if (isUpdated) {
            // Process collection data here
            done();
          } else if (job.attempts.made < this.maxRetries) {
            // If not found, retry after a delay
            return done(new Error('NFT data not found'));
          } else {
            // Exceeded maximum retries
            done(new Error('Exceeded max retries'));
          }
        } catch (error) {
          if (job.attempts.made < this.maxRetries) {
            // Retry on error
            console.log(error);
            return done(error);
          }
          console.log(error);
          done(new Error('Failed to process collection'));
        }
      },
    );
  }

  async updateIPFS(
    collectionAddress: string,
    tokenId: string,
    ipfsUrl: string,
  ): Promise<boolean> {
    const traits = await this.common.getFromIpfs(ipfsUrl);
    console.log(collectionAddress);
    const collection = await this.prisma.collection.findUnique({
      where: {
        address: collectionAddress.toLowerCase(),
      },
    });
    await this.prisma.nFT.update({
      where: {
        id_collectionId: {
          id: tokenId,
          collectionId: collection.id,
        },
      },
      data: {
        Trait: {
          createMany: {
            data: traits.data.attribute,
            skipDuplicates: true,
          },
        },
      },
    });
    return true;
  }
}
