# Stage 1: Build the app with TypeScript
FROM node:18 AS builder

WORKDIR /usr/src/app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies (using npm install instead of npm ci)
RUN npm install --prefer-offline --no-audit --progress=false

# Copy rest of the app and build
COPY . .
RUN npm run build

# Create public/uploads directory (build stage)
RUN mkdir -p public/uploads

# Stage 2: Run the app with only necessary files
FROM node:18

WORKDIR /usr/src/app

# Install Chromium for puppeteer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libx11-6 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      libpangocairo-1.0-0 \
      libx11-xcb1 \
      libxss1 \
      libgtk-3-0 \
      libxshmfence1 \
      libpango-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set puppeteer environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy built files from builder stage
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/start.sh ./start.sh
COPY --from=builder /usr/src/app/public ./public

# 👉 Create necessary directories (including logs)
RUN mkdir -p \
      logs \
      public/uploads/tickets \
      public/uploads/hvac_tickets \
      public/uploads/tickets/followups \
      public/uploads/hvac_tickets/followups \
      public/reports

# 👉 Fix permissions so 'node' user can write
RUN chown -R node:node /usr/src/app \
    && chmod -R 755 public/uploads \
    && chmod -R 755 logs \
    && chmod +x ./start.sh

# Switch to non-root users
USER node

EXPOSE 8003

CMD ["./start.sh"]
