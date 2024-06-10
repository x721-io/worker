import { ApiCallerService } from 'src/modules/api-caller/api-caller.service';
import { CONTRACT_TYPE } from '@prisma/client';
import { gql, GraphQLClient } from 'graphql-request';
import {
  getSdk as getSdk1155,
  GetUserBalance1155QueryVariables,
  GetItems1155QueryVariables,
} from 'src/generated/Template1155/graphql';
import {
  getSdk as getSdk721,
  GetUserBalance721QueryVariables,
  GetItems721QueryVariables,
} from 'src/generated/Template721/graphql';
import axios from 'axios';
import { logger } from 'src/commons';
import { time } from 'console';
import { UnifiedObject } from './subgraph-helper.object';

class subgraphServiceCommon {
  apiService: ApiCallerService;

  async subgraphQueryItems(
    url: string,
    type: CONTRACT_TYPE,
    skip: number,
    first: number,
    createdAt: number,
  ) {
    try {
      if (!url) return;
      const result =
        type == CONTRACT_TYPE.ERC1155
          ? await this.getSubgraphItems1155(url, skip, first, createdAt)
          : await this.getSubgraphItems721(url, skip, first, createdAt);
      return result;
    } catch (error) {
      // console.error(error);
      logger.error(`getDetailFromIPFS: ${error}`);
    }
  }

  async getDetailFromIPFS(ipfsUrl: string) {
    try {
      const result = await axios.get(ipfsUrl);
      return result?.data;
    } catch (error) {
      logger.error(`getDetailFromIPFS: ${error}`);
    }
  }

  // getIpfsPath(url: string): string | null {
  //   // Create a URL object from the input string
  //   const parsedUrl = new URL(url);
  //   // Get the query parameters from the URL
  //   const params = new URLSearchParams(parsedUrl.search);
  //   // Return the value of the 'ipfsPath' parameter or null if it doesn't exist
  //   return params.get('ipfsPath') || params.get('userAddress');
  // }

  isLink(tokenURI: string) {
    // Check if the tokenURI starts with http:// or https://
    return tokenURI.startsWith('http://') || tokenURI.startsWith('https://');
  }
  async getSubgraphItems721(
    url: string,
    skip: number,
    first: number,
    createdAt: number,
  ) {
    try {
      const client = new GraphQLClient(url);
      const sdk = getSdk721(client);
      const variables: GetItems721QueryVariables = {
        skip: skip,
        first: first,
        createdAt: createdAt,
      };
      const reponse = await sdk.getItems721(variables);
      return reponse;
    } catch (error) {
      logger.error(`getSubgraphItems721: ${error}`);
    }
  }

  async getSubgraphItems1155(
    url: string,
    skip: number,
    first: number,
    createdAt: number,
  ) {
    try {
      const client = new GraphQLClient(url);
      const sdk = getSdk1155(client);
      const variables: GetItems1155QueryVariables = {
        skip: skip,
        first: first,
        createdAt: createdAt,
      };
      const reponse = await sdk.getItems1155(variables);
      return reponse;
    } catch (error) {
      logger.error(`getSubgraphItems1155: ${error}`);
    }
  }
  async subgraphQueryOwner(
    url: string,
    type: CONTRACT_TYPE,
    skip: number,
    first: number,
    timestamp: number,
  ) {
    try {
      if (!url) return;
      if (type == CONTRACT_TYPE.ERC1155) {
        const result = await this.getSubgraphOwner1155(
          url,
          skip,
          first,
          timestamp,
        );
        return result?.userBalances as unknown as UnifiedObject[];
      } else {
        const result = await this.getSubgraphOwner721(
          url,
          skip,
          first,
          timestamp,
        );
        return result?.items as unknown as UnifiedObject[];
      }
    } catch (error) {
      logger.error(`getDetailFromIPFS: ${error}`);
    }
  }

  async getSubgraphOwner1155(
    url: string,
    skip: number,
    first: number,
    timestamp: number,
  ) {
    try {
      const client = new GraphQLClient(url);
      const sdk = getSdk1155(client);
      const variables: GetUserBalance1155QueryVariables = {
        skip: skip,
        first: first,
        timestamp: timestamp,
      };
      const reponse = await sdk.getUserBalance1155(variables);
      return reponse;
    } catch (error) {
      logger.error(`getSubgraphOwner1155: ${error}`);
    }
  }

  async getSubgraphOwner721(
    url: string,
    skip: number,
    first: number,
    timestamp: number,
  ) {
    try {
      const client = new GraphQLClient(url);
      const sdk = getSdk721(client);
      const variables: GetUserBalance721QueryVariables = {
        skip: skip,
        first: first,
        timestamp: timestamp,
      };
      const reponse = await sdk.getUserBalance721(variables);
      return reponse;
    } catch (error) {
      logger.error(`getSubgraphOwner721: ${error}`);
    }
  }
}

export default new subgraphServiceCommon();
