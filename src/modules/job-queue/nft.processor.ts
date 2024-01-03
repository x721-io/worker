import { GraphQLClient } from 'graphql-request';
import {
  Get1155NfTsQueryVariables,
  Get721NfTsQueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CONTRACT_TYPE, Collection, NFT, TX_STATUS } from '@prisma/client';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { QUEUE_NAME_NFT } from 'src/constants/Job.constant';
import { Job } from 'bull';
import { NftCrawlerService, NftData } from '../nft-crawler/nft-crawler.service';
import { NotFoundException } from '@nestjs/common';
import { Metadata } from 'src/commons/types/Trait.type';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommonService } from '../common/common.service';
import OtherCommon from 'src/commons/Other.common';

interface NftCrawlRequest {
  type: CONTRACT_TYPE;
  collectionAddress: string;
  txCreation?: string;
}
@Processor(QUEUE_NAME_NFT)
export class NFTsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly NftCrawler: NftCrawlerService,
    private readonly common: CommonService,
  ) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handlePendingFailedNft() {
    console.log('vãi lồn');
    const pendingNfts = await this.prisma.nFT.findMany({
      where: {
        OR: [{ status: TX_STATUS.PENDING }],
      },
      include: {
        collection: true,
      },
    });
    for (let i = 0; i < pendingNfts.length; i++) {
      await this.crawlNftInfoToDbSingle(
        pendingNfts[i],
        pendingNfts[i].collection,
      );
    }
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
          await this.prisma.nFT.updateMany({
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
          await this.prisma.nFT.updateMany({
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

  private async processAndSaveNft(input: NftData[], collection: Collection) {
    // const getMetadata = Promise.all(
    //   input.map(async (i) => {
    //     const uri = await this.common.fetchTokenUri(i.tokenUri);
    //     return uri;
    //   }),
    // );
    const metadataArray: Metadata[] = await this.common.processInBatches(
      input,
      parseInt(process.env.BATCH_PROCESS),
    );
    console.log('ủa: ', metadataArray);
    for (let i = 0; i < input.length; i++) {
      const convertToStringAttr = metadataArray[i]
        ? metadataArray[i].attributes.map((i) => {
            return {
              ...i,
              value: String(i.value),
            };
          })
        : null;
      const { normId, u2uId } = this.getId(input[i].tokenId, collection);
      await this.prisma.nFT.upsert({
        where: {
          id_collectionId: {
            id: normId,
            collectionId: collection.id,
          },
        },
        update: {
          ...(metadataArray[i].name
            ? { name: metadataArray[i].name }
            : { name: input[i].tokenId }),
          status: TX_STATUS.SUCCESS,
          tokenUri: input[i].tokenUri,
          image: metadataArray[i].image,
          Trait: {
            createMany: {
              data: convertToStringAttr,
              skipDuplicates: true,
            },
          },
        },
        create: {
          id: normId,
          ...(metadataArray[i].name
            ? { name: metadataArray[i].name }
            : { name: input[i].tokenId }),
          status: TX_STATUS.SUCCESS,
          tokenUri: input[i].tokenUri,
          txCreationHash: input[i].txCreation,
          collectionId: collection.id,
          image: metadataArray[i].image,
          ...(u2uId && { u2uId }),
          Trait: {
            createMany: {
              data: convertToStringAttr,
              skipDuplicates: true,
            },
          },
        },
      });
      // }
    }
  }

  @Process('nft-crawl-single')
  private async crawlNftInfoToDbSingleJob(job: Job<NftCrawlRequest>) {
    const { txCreation: hash, type } = job.data;
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    console.log('let see: ', hash, type);
    const variables: Get721NfTsQueryVariables | Get1155NfTsQueryVariables = {
      txCreation: hash,
    };
    try {
      if (type === 'ERC721') {
        const { erc721Tokens } = await sdk.Get721NFTs(variables);
        if (erc721Tokens.length > 0) {
          for (let i = 0; i < erc721Tokens.length; i++) {
            const collection = await this.prisma.collection.findUnique({
              where: {
                address: erc721Tokens[i].contract.id,
              },
            });
            if (!collection) {
              throw new NotFoundException('Collection not found');
            }
            const nftExisted = await this.prisma.nFT.findUnique({
              where: {
                id_collectionId: {
                  id: erc721Tokens[i].tokenId.toString(),
                  collectionId: collection.id,
                },
              },
            });
            if (!nftExisted) {
              const uri = await this.NftCrawler.getSingleErc721NftData(
                erc721Tokens[i].tokenId.toString(),
                erc721Tokens[i].contract.id,
              );
              // TODO: fetch metadata
              const metadata: Metadata = await this.common.fetchTokenUri(
                uri.tokenUri,
              );
              // TODO: create nft
              await this.prisma.nFT.create({
                data: {
                  id: erc721Tokens[i].tokenId.toString(),
                  ...(metadata.name
                    ? { name: metadata.name }
                    : { name: erc721Tokens[i].tokenId.toString() }),
                  status: TX_STATUS.SUCCESS,
                  tokenUri: uri.tokenUri,
                  txCreationHash: hash,
                  collectionId: collection.id,
                  ...(metadata.image && { image: metadata.image }),
                  ...(metadata.animation_url && {
                    animationUrl: metadata.animation_url,
                  }),
                  description: metadata.description,
                  Trait: {
                    createMany: {
                      data: metadata.attributes.map((trait) => ({
                        ...trait,
                        value: trait.value.toString(),
                      })),
                      skipDuplicates: true,
                    },
                  },
                },
              });
            }
            return erc721Tokens;
          }
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } else if (type === 'ERC1155') {
        const { erc1155Tokens } = await sdk.Get1155NFTs(variables);
        if (erc1155Tokens.length > 0) {
          for (let i = 0; i < erc1155Tokens.length; i++) {
            const collection = await this.prisma.collection.findUnique({
              where: {
                address: erc1155Tokens[i].contract.id,
              },
            });
            const nftExisted = await this.prisma.nFT.findUnique({
              where: {
                id_collectionId: {
                  id: erc1155Tokens[i].tokenId.toString(),
                  collectionId: collection.id,
                },
              },
            });
            if (!nftExisted) {
              const uri = await this.NftCrawler.getSingleErc1155NftData(
                erc1155Tokens[i].tokenId.toString(),
                erc1155Tokens[i].contract.id,
              );
              // TODO: fetch metadata
              const metadata: Metadata = await this.common.fetchTokenUri(
                uri.tokenUri,
              );
              // TODO: create nft
              await this.prisma.nFT.create({
                data: {
                  id: erc1155Tokens[i].tokenId.toString(),
                  ...(metadata.name
                    ? { name: metadata.name }
                    : { name: erc1155Tokens[i].tokenId.toString() }),
                  status: TX_STATUS.SUCCESS,
                  tokenUri: uri.tokenUri,
                  txCreationHash: hash,
                  collectionId: collection.id,
                  ...(metadata.image && { image: metadata.image }),
                  ...(metadata.animation_url && {
                    animationUrl: metadata.animation_url,
                  }),
                  description: metadata.description,
                  Trait: {
                    createMany: {
                      data: metadata.attributes.map((trait) => ({
                        ...trait,
                        value: trait.value.toString(),
                      })),
                      skipDuplicates: true,
                    },
                  },
                },
              });
            }
            return erc1155Tokens;
          }
        } else {
          throw new Error('NO TX FOUND YET');
        }
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }
  private async crawlNftInfoToDbSingle(tokenId: NFT, collectionId: Collection) {
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    const variables: Get721NfTsQueryVariables | Get1155NfTsQueryVariables = {
      txCreation: tokenId.txCreationHash,
    };
    let normId;
    if (collectionId.isU2U) normId = tokenId.u2uId;
    else normId = tokenId.id;
    try {
      if (collectionId.type === 'ERC721') {
        const { erc721Tokens } = await sdk.Get721NFTs(variables);
        if (erc721Tokens.length > 0) {
          const uri = await this.NftCrawler.getSingleErc721NftData(
            normId,
            collectionId.address,
          );
          // TODO: fetch metadata
          const metadata: Metadata = await this.common.fetchTokenUri(
            uri.tokenUri,
          );
          await this.prisma.nFT.update({
            where: {
              id_collectionId: {
                id: tokenId.id,
                collectionId: collectionId.id,
              },
            },
            data: {
              status: TX_STATUS.SUCCESS,
              ...(metadata.image && { image: metadata.image }),
              ...(metadata.animation_url && {
                animationUrl: metadata.animation_url,
              }),
              ...(metadata.name ? { name: metadata.name } : { name: normId }),
              description: metadata.description,
              Trait: {
                createMany: {
                  data: metadata.attributes.map((trait) => ({
                    ...trait,
                    value: trait.value.toString(),
                  })),
                  skipDuplicates: true,
                },
              },
            },
          });
          // }
          return erc721Tokens;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } else if (collectionId.type === 'ERC1155') {
        const { erc1155Tokens } = await sdk.Get1155NFTs(variables);
        if (erc1155Tokens.length > 0) {
          const uri = await this.NftCrawler.getSingleErc1155NftData(
            normId,
            collectionId.address,
          );
          // TODO: fetch metadata
          const metadata: Metadata = await this.common.fetchTokenUri(
            uri.tokenUri,
          );
          // TODO: create nft
          await this.prisma.nFT.update({
            where: {
              id_collectionId: {
                id: tokenId.id,
                collectionId: collectionId.id,
              },
            },
            data: {
              status: TX_STATUS.SUCCESS,
              ...(metadata.image && { image: metadata.image }),
              ...(metadata.animation_url && { name: metadata.animation_url }),
              description: metadata.description,
              ...(metadata.name ? { name: metadata.name } : { name: normId }),
              Trait: {
                createMany: {
                  data: metadata.attributes.map((trait) => ({
                    ...trait,
                    value: trait.value.toString(),
                  })),
                  skipDuplicates: true,
                },
              },
            },
          });
          // }
          return erc1155Tokens;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  @Process('nft-crawl-collection')
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
      await this.processAndSaveNft(res, collection);
    } else {
      const res = await this.NftCrawler.getAllErc721NftData(collectionAddress);
      await this.processAndSaveNft(res, collection);
    }
  }

  getId(
    tokenId: string,
    collection: Collection,
  ): { normId: string; u2uId?: string } {
    let normId;
    let u2uId;
    if (collection.isU2U) {
      normId = OtherCommon.getNormIdFromU2UId(tokenId);
      u2uId = tokenId;
    } else {
      normId = tokenId;
    }
    return { normId, u2uId };
  }

  // TODO: BUY SELL TRANSFER BID EVENT

  @OnQueueFailed()
  private async onNFTCreateFail(job: Job<any>, error: Error) {
    console.error(`Job failed: ${job.id} with error: ${error.message}`);
    const hash = job.data.txCreation;
    const retry = job.attemptsMade;
    try {
      if (retry >= parseInt(process.env.MAX_RETRY))
        await this.prisma.nFT.updateMany({
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
