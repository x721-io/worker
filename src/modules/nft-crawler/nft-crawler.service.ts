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
import { PrismaService } from 'src/prisma/prisma.service';
import { logger } from 'src/commons';
import { NFTDataResponse } from '../job-queue/nft.processor';

export interface NftData {
  tokenId: string;
  tokenUri: string;
  contractType: CONTRACT_TYPE;
  txCreation?: string;
}

@Injectable()
export class NftCrawlerService {
  constructor(
    private readonly graphQl: GraphQlcallerService,
    private readonly prisma: PrismaService,
  ) {}

  private provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

  private multicall = new Multicall({
    ethersProvider: this.provider,
    tryAggregate: true,
    multicallCustomContractAddress: process.env.MULTICALL_CONTRACT,
  });

  async processNFTAsset(nft: NFTDataResponse) {
    try {
      const { id, tokenId, collectionAddress, metadata } = nft;

      const collection = await this.prisma.collection.findUnique({
        where: {
          address: collectionAddress,
        },
      });

      if (!collection) {
        return;
      }

      const attributes = metadata?.metadata?.attributes || [];

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
          name: metadata?.metadata.name || tokenId,
          description: metadata?.metadata.description || '',
          image: metadata?.metadata.image || '',
          tokenUri: metadata?.IPFSUrl || '',
          status: TX_STATUS.SUCCESS,
          txCreationHash: id,
          collectionId: collection.id,
          Trait: {
            create:
              attributes.length > 0
                ? attributes.map((attribute) => ({
                    trait_type: attribute.trait_type,
                    value: attribute.value.toString(),
                    nftId: tokenId,
                    collectionId: collection.id,
                  }))
                : undefined,
          },
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
