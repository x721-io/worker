import { GraphQLClient } from 'graphql-request';
import {
  Get1155NfTsQueryVariables,
  Get721NfTsQueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CONTRACT_TYPE, TX_STATUS } from '@prisma/client';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { QUEUE_NAME_NFT } from 'src/constants/Job.constant';
import { Job } from 'bull';
import { NftCrawlerService } from '../nft-crawler/nft-crawler.service';
import { NotFoundException } from '@nestjs/common';
import { Metadata } from 'src/commons/types/Trait.type';

interface NftCrawlRequest {
  type: CONTRACT_TYPE;
  collectionAddress: string;
}
@Processor(QUEUE_NAME_NFT)
export class NFTsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly NftCrawler: NftCrawlerService,
  ) {}

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

  @Process('nft-crawl')
  private async crawlNftInfoToDb(job: Job<NftCrawlRequest>) {
    const { type, collectionAddress } = job.data;
    const collection = await this.prisma.collection.findUnique({
      where: {
        address: collectionAddress.toLowerCase(),
      },
    });
    if (!collection) throw new NotFoundException('Collection not found');

    if (type === 'ERC1155') {
      const res = await this.NftCrawler.getAllErc1155NftData(collectionAddress);
      console.log(res);
    } else {
      const res = await this.NftCrawler.getAllErc721NftData(collectionAddress);
      console.log(res);
      const getMetadata = Promise.all(
        res.map(async (i) => {
          const resposne = await fetch(i.tokenUri);
          return resposne.json();
        }),
      );
      const metadataArray: Metadata[] = await getMetadata;
      for (let i = 0; i < res.length; i++) {
        console.log('attributes: ', metadataArray[i].attributes);
        const convertToStringAttr = metadataArray[i].attributes.map((i) => ({
          ...i,
          value: String(i.value),
        }));
        await this.prisma.nFT.create({
          data: {
            id: res[i].tokenId.toString(),
            name: metadataArray[i].name,
            status: TX_STATUS.SUCCESS,
            tokenUri: res[i].tokenUri,
            txCreationHash: res[i].txCreation,
            collectionId: collection.id,
            ipfsHash: '',
            imageHash: metadataArray[i].image,
            Trait: {
              createMany: {
                data: convertToStringAttr,
                skipDuplicates: true,
              },
            },
          },
        });
      }
    }
    //   await this.prisma.nFT.updateMany({
    //     where: {
    //       id_collectionId: {
    //         id: res,
    //         collectionId: collection.id,
    //       },
    //     },
    //     data: {
    //       Trait: {
    //         createMany: {
    //           data: traits.data.attribute,
    //           skipDuplicates: true,
    //         },
    //       },
    //     },
    //   });
    // }
  }

  // TODO: BUY SELL TRANSFER BID EVENT
  @Process('nft_buy')
  private async handleBuy(job: Job<{}>, error: Error) {}

  @Process('nft_bid')
  private async handleBid(job: Job<{}>, error: Error) {}
  @Process('nft_transfer')
  private async handleTransfer(job: Job<{}>, error: Error) {}

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
