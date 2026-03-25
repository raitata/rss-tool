FROM node:20-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Create data directory for persistence
RUN mkdir -p /app/data

# Expose the application port
EXPOSE 55794

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:55794/api/feeds || exit 1

# Run the application
CMD ["node", "server.js"]
