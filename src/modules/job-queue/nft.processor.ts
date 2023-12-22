import { GraphQLClient } from 'graphql-request';
import {
  Get1155NfTsQueryVariables,
  Get721NfTsQueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CONTRACT_TYPE, Collection, TX_STATUS } from '@prisma/client';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { QUEUE_NAME_NFT } from 'src/constants/Job.constant';
import { Job } from 'bull';
import { NftCrawlerService, NftData } from '../nft-crawler/nft-crawler.service';
import { NotFoundException } from '@nestjs/common';
import { Metadata } from 'src/commons/types/Trait.type';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommonService } from '../common/common.service';

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
    console.log(pendingNfts);
    for (let i = 0; i < pendingNfts.length; i++) {
      await this.crawlNftInfoToDbSingle(
        pendingNfts[i].txCreationHash,
        pendingNfts[i].collection.type,
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

  private async processAndSaveNft(input: NftData[], collection: Collection) {
    const getMetadata = Promise.all(
      input.map(async (i) => {
        try {
          const response = await fetch(i.tokenUri);
          if (!response.ok) {
            return null; // Or an appropriate value for a failed fetch
          }
          return response.json();
        } catch (error) {
          console.error('Fetch failed:');
          return (await this.common.getFromIpfs(i.tokenUri)).data;
          // Or an appropriate value for a failed fetch
        }
      }),
    );
    const metadataArray: Metadata[] = await getMetadata;
    for (let i = 0; i < input.length; i++) {
      const convertToStringAttr = metadataArray[i]
        ? metadataArray[i].attributes.map((i) => {
            return {
              ...i,
              value: String(i.value),
            };
          })
        : null;
      const nftExisted = await this.prisma.nFT.findUnique({
        where: {
          id_collectionId: {
            id: input[i].tokenId.toString(),
            collectionId: collection.id,
          },
        },
      });
      if (!nftExisted) {
        await this.prisma.nFT.upsert({
          where: {
            txCreationHash: input[i].txCreation,
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
            id: input[i].tokenId.toString(),
            ...(metadataArray[i].name
              ? { name: metadataArray[i].name }
              : { name: input[i].tokenId }),
            status: TX_STATUS.SUCCESS,
            tokenUri: input[i].tokenUri,
            txCreationHash: input[i].txCreation,
            collectionId: collection.id,
            image: metadataArray[i].image,
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
        console.log(erc721Tokens[0].tokenId);
        if (erc721Tokens.length > 0) {
          const collection = await this.prisma.collection.findUnique({
            where: {
              address: erc721Tokens[0].contract.id,
            },
          });
          const nftExisted = await this.prisma.nFT.findUnique({
            where: {
              id_collectionId: {
                id: erc721Tokens[0].tokenId.toString(),
                collectionId: collection.id,
              },
            },
          });
          if (!nftExisted) {
            const uri = await this.NftCrawler.getSingleErc721NftData(
              erc721Tokens[0].tokenId.toString(),
              erc721Tokens[0].contract.id,
            );
            // TODO: fetch metadata
            let metadata: Metadata;
            try {
              const response = await fetch(uri.tokenUri);
              if (!response.ok) {
                throw new Error('Metadata uri is incorrect');
              }
              metadata = (await response.json()) as Metadata;
            } catch (error) {
              console.error('Fetch failed:');
              return null; // Or an appropriate value for a failed fetch
            }
            // TODO: create nft
            await this.prisma.nFT.create({
              data: {
                id: erc721Tokens[0].tokenId.toString(),
                name: metadata.name,
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
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } else if (type === 'ERC1155') {
        const { erc1155Tokens } = await sdk.Get1155NFTs(variables);
        if (erc1155Tokens.length > 0) {
          console.log('ok');
          const collection = await this.prisma.collection.findUnique({
            where: {
              address: erc1155Tokens[0].contract.id,
            },
          });
          const nftExisted = await this.prisma.nFT.findUnique({
            where: {
              id_collectionId: {
                id: erc1155Tokens[0].tokenId.toString(),
                collectionId: collection.id,
              },
            },
          });
          if (!nftExisted) {
            const uri = await this.NftCrawler.getSingleErc721NftData(
              erc1155Tokens[0].tokenId.toString(),
              erc1155Tokens[0].contract.id,
            );
            // TODO: fetch metadata
            let metadata: Metadata;
            try {
              const response = await fetch(uri.tokenUri);
              if (!response.ok) {
                throw new Error('Metadata uri is incorrect');
              }
              metadata = (await response.json()) as Metadata;
            } catch (error) {
              console.error('Fetch failed:');
              return null; // Or an appropriate value for a failed fetch
            }
            // TODO: create nft
            await this.prisma.nFT.create({
              data: {
                id: erc1155Tokens[0].tokenId.toString(),
                name: metadata.name,
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
        } else {
          throw new Error('NO TX FOUND YET');
        }
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }
  private async crawlNftInfoToDbSingle(hash: string, type: CONTRACT_TYPE) {
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    console.log('let see: ', hash, type);
    const variables: Get721NfTsQueryVariables | Get1155NfTsQueryVariables = {
      txCreation: hash,
    };
    try {
      if (type === 'ERC721') {
        const { erc721Tokens } = await sdk.Get721NFTs(variables);
        console.log(erc721Tokens[0].tokenId);
        if (erc721Tokens.length > 0) {
          const collection = await this.prisma.collection.findUnique({
            where: {
              address: erc721Tokens[0].contract.id,
            },
          });
          const uri = await this.NftCrawler.getSingleErc721NftData(
            erc721Tokens[0].tokenId.toString(),
            erc721Tokens[0].contract.id,
          );
          // TODO: fetch metadata
          let metadata: Metadata;
          try {
            console.log('URI: ', uri.tokenUri);
            metadata = (await this.common.getFromIpfs(uri.tokenUri)).data;
            // const response = await fetch(uri.tokenUri);
            // if (!response.ok) {
            //   throw new Error('Metadata uri is incorrect');
            // }
            // metadata = (await response.json()) as Metadata;
          } catch (error) {
            console.error('Fetch failed: ', error);
            return null; // Or an appropriate value for a failed fetch
          }
          // TODO: create nft
          await this.prisma.nFT.upsert({
            where: {
              txCreationHash: hash,
            },
            update: {
              status: TX_STATUS.SUCCESS,
              ...(metadata.image && { image: metadata.image }),
              ...(metadata.animation_url && {
                animationUrl: metadata.animation_url,
              }),
              name: metadata.name,
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
            create: {
              id: erc721Tokens[0].tokenId.toString(),
              name: metadata.name,
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
          // }
          return erc721Tokens;
        } else {
          throw new Error('NO TX FOUND YET');
        }
      } else if (type === 'ERC1155') {
        const { erc1155Tokens } = await sdk.Get1155NFTs(variables);
        if (erc1155Tokens.length > 0) {
          console.log('ok');
          const collection = await this.prisma.collection.findUnique({
            where: {
              address: erc1155Tokens[0].contract.id,
            },
          });
          const nftExisted = await this.prisma.nFT.findUnique({
            where: {
              id_collectionId: {
                id: erc1155Tokens[0].tokenId.toString(),
                collectionId: collection.id,
              },
            },
          });
          // if (!nftExisted) {
          const uri = await this.NftCrawler.getSingleErc721NftData(
            erc1155Tokens[0].tokenId.toString(),
            erc1155Tokens[0].contract.id,
          );
          // TODO: fetch metadata
          let metadata: Metadata;
          try {
            const response = await fetch(uri.tokenUri);
            if (!response.ok) {
              throw new Error('Metadata uri is incorrect');
            }
            metadata = (await response.json()) as Metadata;
          } catch (error) {
            console.error('Fetch failed:');
            return null; // Or an appropriate value for a failed fetch
          }
          // TODO: create nft
          await this.prisma.nFT.upsert({
            where: {
              txCreationHash: hash,
            },
            update: {
              status: TX_STATUS.SUCCESS,
              ...(metadata.image && { image: metadata.image }),
              ...(metadata.animation_url && { name: metadata.animation_url }),
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
            create: {
              id: erc1155Tokens[0].tokenId.toString(),
              name: metadata.name,
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
      console.log(res);
      await this.processAndSaveNft(res, collection);
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
