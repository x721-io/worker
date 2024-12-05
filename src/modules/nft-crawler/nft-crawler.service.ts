import { Injectable } from '@nestjs/common';
import { abi as abi721 } from 'abis/ERC721Proxy.json';
import { abi as abi1155 } from 'abis/ERC1155Proxy.json';
import { ethers } from 'ethers';
import { GraphQlcallerService } from '../graph-qlcaller/graph-qlcaller.service';
import { CONTRACT_TYPE, TX_STATUS } from '@prisma/client';
import {
  Multicall,
  ContractCallResults,
  ContractCallContext,
} from 'ethereum-multicall';
import { RedisSubscriberService } from '../job-queue/redis.service';
import { PrismaService } from 'src/prisma/prisma.service';
import axios from 'axios';
import { logger } from 'src/commons';

export interface NftData {
  tokenId: string;
  tokenUri: string;
  contractType: CONTRACT_TYPE;
  txCreation?: string;
}

interface NFTDataResponse {
  id: string;
  name: string;
  type: string;
  tokenId: string;
  description: string;
  collectionAddress: string;
  media: Media;
  metadata: Media;
  gameInfo: GameInfo;
  createdAt: string;
}

interface GameInfo {
  id: string;
  name: string;
}

interface Media {
  id: string;
  S3Url?: string;
  IPFSUrl: string;
  AssetId: string;
  metadata?: Metadata;
}

interface Metadata {
  name: string;
  image: string;
  description: string;
  external_url: string;
}

interface NFTAssetResponse {
  data: NFTDataResponse[];
  paging: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

@Injectable()
export class NftCrawlerService {
  constructor(
    private readonly graphQl: GraphQlcallerService,
    private readonly redisService: RedisSubscriberService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly LAST_CRAWL_TIMESTAMP_KEY = 'nft:last_crawl_timestamp';
  private readonly CRAWLER_LOCK_KEY = 'nft:crawler_lock';
  private readonly LOCK_TIMEOUT = 5 * 60; // 5 minutes in seconds
  private readonly API_BASE_URL = process.env.DEV_API_URL;
  private provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

  private multicall = new Multicall({
    ethersProvider: this.provider,
    tryAggregate: true,
    multicallCustomContractAddress: process.env.MULTICALL_CONTRACT,
  });

  async crawlNFTAssets() {
    const locked = await this.acquireLock();
    if (!locked) {
      logger.warn('Another crawler instance is still running');
      return false;
    }

    try {
      let lastTimestamp = await this.redisService.redisGetSet.get(
        this.LAST_CRAWL_TIMESTAMP_KEY,
      );
      if (!lastTimestamp) {
        lastTimestamp = '2024-01-01T00:00:00.000Z';
      }

      let currentPage = 1;
      const limit = 20;
      let hasNext = true;

      while (hasNext) {
        const url = `${this.API_BASE_URL}/api/nft/assets?created_at=${lastTimestamp}&limit=${limit}&page=${currentPage}`;
        const response = await axios.get<NFTAssetResponse>(url);
        const { data, paging } = response.data;

        if (data.length > 0) {
          for (const nft of data) {
            await this.processNFTAsset(nft);
          }

          const newestNFT = data[0];
          await this.redisService.set(
            this.LAST_CRAWL_TIMESTAMP_KEY,
            newestNFT.createdAt,
          );
        }

        hasNext = paging.hasNext;
        currentPage++;
      }

      return true;
    } catch (error) {
      logger.error('Error crawling NFT assets:', error);
      throw error;
    } finally {
      // Release lock in finally block to ensure it's always released
      await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<boolean> {
    const lockValue = Date.now().toString();
    try {
      // Using set with options for atomic lock acquisition
      const result = await this.redisService.redisGetSet.set(
        this.CRAWLER_LOCK_KEY,
        lockValue,
        'EX',
        this.LOCK_TIMEOUT,
      );
      return result === 'OK';
    } catch (error) {
      logger.error('Error acquiring lock:', error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.redisService.redisGetSet.del(this.CRAWLER_LOCK_KEY);
    } catch (error) {
      logger.error('Error releasing lock:', error);
    }
  }

  private async processNFTAsset(nft: NFTDataResponse) {
    try {
      const {
        id,
        name,
        tokenId,
        description,
        collectionAddress,
        media,
        metadata,
      } = nft;

      const collection = await this.prisma.collection.findUnique({
        where: {
          address: collectionAddress.toLowerCase(),
        },
      });

      if (!collection) {
        return;
      }

      await this.prisma.nFT.upsert({
        where: {
          id_collectionId: {
            id: tokenId,
            collectionId: collection.id,
          },
        },
        update: {},
        create: {
          id: tokenId,
          name: name || tokenId,
          description,
          image: media?.S3Url || '',
          tokenUri: metadata?.S3Url || '',
          status: TX_STATUS.SUCCESS,
          txCreationHash: id,
          collectionId: collection.id,
        },
      });
    } catch (error) {
      logger.error(`Error processing NFT asset ${nft.id}:`, error);
      throw error;
    }
  }

  async getSingleErc721NftData(
    tokenId: string,
    contractAddress: string,
  ): Promise<NftData> {
    const erc721Contract = new ethers.Contract(
      contractAddress,
      abi721,
      this.provider,
    );
    try {
      const tokenUri = await erc721Contract.tokenURI(tokenId);
      return {
        tokenId,
        tokenUri,
        contractType: 'ERC721',
      };
    } catch (err) {
      logger.error('Error in ERC-721:', tokenId, err);
    }
  }

  async getSingleErc1155NftData(
    tokenId: string,
    contractAddress: string,
  ): Promise<NftData> {
    const erc1155Contract = new ethers.Contract(
      contractAddress,
      abi1155,
      this.provider,
    );
    try {
      const tokenUri = await erc1155Contract.uri(tokenId);
      return {
        tokenId,
        tokenUri,
        contractType: 'ERC1155',
      };
    } catch (err) {
      logger.error('Error in ERC-1155:', tokenId, err);
    }
  }

  async getAllErc721NftData(contractAddress: string): Promise<NftData[]> {
    const nfts = [];
    let skip = 0;
    const first = 1000;
    let hasMore = true;
    while (hasMore) {
      const { erc721Tokens } = await this.graphQl.getNFTFromCollection(
        contractAddress,
        first,
        skip,
      );
      const contractCallContext: ContractCallContext[] = erc721Tokens.map(
        (token) => ({
          reference: `tokenURI-${token.tokenId}`,
          contractAddress: contractAddress,
          abi: abi721,
          calls: [
            {
              reference: `tokenURI-${token.tokenId}`,
              methodName: 'tokenURI',
              methodParameters: [token.tokenId],
            },
          ],
        }),
      );
      const results: ContractCallResults =
        await this.multicall.call(contractCallContext);

      const fetchedTokensCount = erc721Tokens.length;
      erc721Tokens.forEach((token) => {
        const result = results.results[`tokenURI-${token.tokenId}`];
        if (result && result.callsReturnContext[0].success) {
          const tokenUri = result.callsReturnContext[0].returnValues[0];
          nfts.push({
            tokenId: token.tokenId,
            tokenUri,
            contractType: 'ERC721',
            txCreation: token.txCreation,
          });
        }
      });
      if (fetchedTokensCount < first) {
        hasMore = false;
      } else {
        skip += fetchedTokensCount;
      }
    }
    return nfts;
  }

  async getAllErc1155NftData(contractAddress: string): Promise<NftData[]> {
    const nfts = [];
    let skip = 0;
    const first = 1000;
    let hasMore = true;
    while (hasMore) {
      const { erc1155Tokens } = await this.graphQl.getNFTFromCollection(
        contractAddress,
        first,
        skip,
      );
      const contractCallContext: ContractCallContext[] = erc1155Tokens.map(
        (token) => ({
          reference: `tokenURI-${token.tokenId}`,
          contractAddress: contractAddress,
          abi: abi1155,
          calls: [
            {
              reference: `tokenURI-${token.tokenId}`,
              methodName: 'uri',
              methodParameters: [token.tokenId],
            },
          ],
        }),
      );
      const results: ContractCallResults =
        await this.multicall.call(contractCallContext);

      const fetchedTokensCount = erc1155Tokens.length;
      erc1155Tokens.forEach((token) => {
        const result = results.results[`tokenURI-${token.tokenId}`];
        if (result && result.callsReturnContext[0].success) {
          const tokenUri = result.callsReturnContext[0].returnValues[0];
          nfts.push({
            tokenId: token.tokenId,
            tokenUri,
            contractType: 'ERC1155',
            txCreation: token.txCreation,
          });
        }
      });
      if (fetchedTokensCount < first) {
        hasMore = false;
      } else {
        skip += fetchedTokensCount;
      }
    }
    return nfts;
  }
}
