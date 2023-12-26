import { Injectable } from '@nestjs/common';
import {
  GetCollectionTokensQueryVariables,
  getSdk,
} from '../../generated/graphql';
import { GraphQLClient } from 'graphql-request';
@Injectable()
export class GraphQlcallerService {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  async getNFTFromCollection(
    contractAddress: string,
    first: number,
    skip: number,
  ) {
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    const variables: GetCollectionTokensQueryVariables = {
      collectionAddress: contractAddress,
      first,
      skip,
    };
    const response = sdk.GetCollectionTokens(variables);
    return response;
  }
}
