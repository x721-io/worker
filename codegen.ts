
import type { CodegenConfig } from '@graphql-codegen/cli';

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const config: CodegenConfig = {
  overwrite: true,
  schema: [
    process.env.SUBGRAPH_URL as string,
    process.env.SUBGRAPH_URL_STAKING as string,  // Use type assertion to ensure non-undefined value
  ],
  documents: 'src/**/*.graphql',
  generates: {
    "src/generated/graphql.ts": {
      plugins: ["typescript", "typescript-resolvers", "typescript-graphql-request", "typescript-operations"]
    },
  }
};

export default config;
