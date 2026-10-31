FROM node:22-slim

WORKDIR /app

# Copy root packages and web packages
COPY package*.json ./
COPY web/package*.json ./web/

# Install root dependencies and web dependencies
RUN npm ci --omit=dev
RUN cd web && npm ci

# Copy the rest of the application code
COPY src/ ./src/
COPY web/ ./web/

# Set production environment and build the Nuxt SSR application
ENV NODE_ENV=production
WORKDIR /app/web
RUN npm run build

# Move back to root directory
WORKDIR /app

# Expose port
EXPOSE 3000

# Set environment variables for Nitro server
ENV PORT=3000
ENV HOST=0.0.0.0

# Start Nuxt SSR server
CMD ["node", "web/.output/server/index.mjs"]
