#!/bin/sh

# Run database migrations
npx prisma migrate deploy

# Start the NestJS server
yarn start:prod
