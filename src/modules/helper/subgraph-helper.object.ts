export interface Owner {
  id: string;
}

export interface Token {
  tokenURI: string;
  tokenID: string;
  id: string;
}

export interface UnifiedObject {
  stakedAmount?: number;
  lastUpdated?: string;
  id: string;
  burnQuantity?: number;
  balance?: string;
  owner: Owner;
  token?: Token;
  createdAt?: Date;
  tokenURI?: string;
  tokenID?: string;
}
