import { Injectable } from '@nestjs/common';
import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import { Get1155NfTsQueryVariables, Get721NfTsQueryVariables, getSdk } from 'src/generated/graphql';
import { QueueService } from './queue.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';

@Injectable()
export class NFTsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;
  private readonly maxRetries = 5;

  constructor(private queueService: QueueService, private readonly prisma: PrismaService) {
    this.queueService.getQueue().process('nft', async (job: Job<{ txCreation: string, type: "ERC721" | "ERC1155" }>, done) => {
      try {
        const hash = JSON.parse(job.data).txCreation;
        const type = JSON.parse(job.data).type;
        const collectionData = await this.checkNFTStatus(hash, type);
        if (collectionData && ('erc721Tokens' in collectionData && collectionData.erc721Tokens.length > 0 || 'erc1155Tokens' in collectionData && collectionData.erc1155Tokens.length > 0)) {
          // Process collection data here
          done();
        } else if (job.attempts.made < this.maxRetries) {
          // If not found, retry after a delay
          await this.prisma.nFT.update({
            where: {
              txCreationHash: hash
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          return done(new Error('NFT data not found'));
        } else {
          // Exceeded maximum retries
          await this.prisma.nFT.update({
            where: {
              txCreationHash: hash
            },
            data: {
              status: TX_STATUS.FAILED,
            }
          })
          await this.prisma.nFT.update({
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

  private async checkNFTStatus(hash: string, type: 'ERC721' | 'ERC1155') {
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    console.log('let see: ', hash)
    const variables: Get721NfTsQueryVariables | Get1155NfTsQueryVariables = { txCreation: hash };
    try {
        if (type === 'ERC721') {
            const response = await sdk.Get721NFTs(variables);
            console.log(response);
            if (response.erc721Tokens.length > 0) {
              await this.prisma.nFT.update({
                where: {
                  txCreationHash: hash
                },
                data: {
                  status: TX_STATUS.SUCCESS,
                }
              })
            }
            return response;
        }
        else if (type === 'ERC1155') {
            const response = await sdk.Get1155NFTs(variables);
            if (response.erc1155Tokens.length > 0) {
                await this.prisma.nFT.update({
                    where: {
                        txCreationHash: hash,
                    },
                    data: {
                        status: TX_STATUS.SUCCESS
                    }
                })
            }
            return response;
        }
    } catch (err) {
      console.log(err);
    }
  }
}
