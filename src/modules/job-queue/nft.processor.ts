import { GraphQLClient } from 'graphql-request';
import {
  Get1155NfTsQueryVariables,
  Get721NfTsQueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';
import { Process, Processor } from '@nestjs/bull';
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
        }
        return response;
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
        }
        return response;
      }
    } catch (err) {
      console.log(err);
    }
  }
}
