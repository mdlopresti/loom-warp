# NATS MCP Server Dockerfile
# Multi-stage build for minimal image size

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy schema files if needed
COPY schemas/ ./schemas/

# Set environment variables
ENV NODE_ENV=production
# NATS_URL: Connection URL for NATS server
# Default is for local development - override this in production deployments
# Example: nats://nats-server:4222 or nats://user:password@nats-server:4222
ENV NATS_URL=nats://localhost:4222

# Security: Run as non-root user
RUN chown -R node:node /app
USER node

# The MCP server uses stdio transport, so we need -i for interactive
# This is handled by the entrypoint
ENTRYPOINT ["node", "dist/index.js"]
