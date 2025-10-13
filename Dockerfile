FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY config.yaml ./
COPY run.sh ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S deadman -u 1001

# Change ownership of the app directory
RUN chown -R deadman:nodejs /app
RUN chmod +x /app/run.sh
USER deadman

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Default command
CMD ["./run.sh"]
