import { GraphQLClient } from 'graphql-request';
import {
  Get1155NfTsQueryVariables,
  Get721NfTsQueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { QUEUE_NAME_NFT } from 'src/constants/Job.constant';
import { Job } from 'bull';

@Processor(QUEUE_NAME_NFT)
export class NFTsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(private readonly prisma: PrismaService) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  @Process('nft-create')
  private async checkNFTStatus(job: Job<any>) {
    const { txCreation: hash, type } = job.data;
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    console.log('let see: ', hash, type);
    const variables: Get721NfTsQueryVariables | Get1155NfTsQueryVariables = {
      txCreation: hash,
    };
    try {
      if (type === 'ERC721') {
        const response = await sdk.Get721NFTs(variables);
        console.log(response);
        if (response.erc721Tokens.length > 0) {
          await this.prisma.nFT.update({
            where: {
              txCreationHash: hash,
            },
            data: {
              status: TX_STATUS.SUCCESS,
            },
          });
          return response;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } else if (type === 'ERC1155') {
        const response = await sdk.Get1155NFTs(variables);
        if (response.erc1155Tokens.length > 0) {
          await this.prisma.nFT.update({
            where: {
              txCreationHash: hash,
            },
            data: {
              status: TX_STATUS.SUCCESS,
            },
          });
          return response;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  // TODO: BUY SELL TRANSFER BID EVENT
  @OnQueueFailed()
  private async onNFTCreateFail(job: Job<any>, error: Error) {
    console.error(`Job failed: ${job.id} with error: ${error.message}`);
    const hash = job.data.txCreation;
    const retry = job.attemptsMade;
    try {
      if (retry >= parseInt(process.env.MAX_RETRY))
        await this.prisma.nFT.update({
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
