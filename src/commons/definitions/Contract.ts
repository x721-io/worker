import { Contract, ethers } from 'ethers';

export type TransferNFTsToNextRoundFunction = (
  addressRoundWL: string,
  newMaxAmountNFTPerWallet: number,
) => Promise<ethers.ContractTransaction>;
