import { Injectable } from '@nestjs/common';
import { create } from 'ipfs-http-client';
import { PrismaService } from 'src/prisma/prisma.service';
@Injectable()
export class CommonService {
  private ipfs;
  constructor() {
    this.ipfs = create({
      host: process.env.IPFS_URL,
      port: parseInt(process.env.IPFS_PORT),
      protocol: process.env.IPFS_PROTOCOL,
    });
  }

  async uploadIpfs(files: Express.Multer.File[], metadata: any) {
    try {
      const fileResults = await Promise.all(
        files.map((file) => this.ipfs.add(file.buffer)),
      );
      const fileHashes = fileResults.map((result) => result.path);
      if (metadata) {
        const metadataObject = JSON.parse(metadata);
        const updatedMetadata = { ...metadataObject, fileHashes };

        const metadataResult = await this.ipfs.add(
          JSON.stringify(updatedMetadata),
        );
        return {
          fileHashes: fileHashes,
          metadataHash: metadataResult.path,
        };
      } else {
        return { fileHashes: fileHashes };
      }
    } catch (err) {
      console.log('err: ', err);
    }
  }

  async getFromIpfs(hash: string): Promise<{ data: any; type: string }> {
    try {
      const content = [];
      const { cid } = this.parseIpfsPath(hash);
      for await (const chunk of this.ipfs.cat(cid)) {
        content.push(chunk);
      }
      const buffer = Buffer.concat(content);

      // Try to parse buffer as JSON
      try {
        const json = JSON.parse(buffer.toString());
        return { data: json, type: 'json' };
      } catch (e) {
        // If it's not JSON, return it as a file
        return { data: buffer, type: 'file' };
      }
    } catch (err) {
      console.error('Error retrieving content from IPFS:', err);
      throw err;
    }
  }
  private parseIpfsPath(ipfsPath: string): { cid: string; filePath: string } {
    if (ipfsPath.includes('ipfs://ipfs/')) {
      const pathParts = ipfsPath.replace('ipfs://ipfs/', '').split('/');
      const cid = pathParts[0];
      const filePath = pathParts.slice(1).join('/');

      return { cid, filePath };
    } else {
      const pathParts = ipfsPath.replace('ipfs://', '').split('/');
      const cid = pathParts[0];
      const filePath = pathParts.slice(1).join('/');

      return { cid, filePath };
    }
  }

  async processInBatches(input, batchSize) {
    const results = [];
    for (let i = 0; i < input.length; i += batchSize) {
      const batch = input.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((i) => this.fetchTokenUri(i.tokenUri)),
      );
      results.push(...batchResults);
    }
    return results;
  }

  async fetchTokenUri(tokenUri: string) {
    try {
      console.log('hở: ', tokenUri);
      const response = await fetch(tokenUri);
      if (!response.ok) {
        return null; // Or an appropriate value for a failed fetch
      }
      // console.log(response.json())
      return response.json();
    } catch (error) {
      console.error('Fetch failed:');
      return (await this.getFromIpfs(tokenUri)).data;
      // Or an appropriate value for a failed fetch
    }
  }
}
