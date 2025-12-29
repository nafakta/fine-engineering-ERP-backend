# Stage 1: Build the app with TypeScript
FROM node:18 AS builder

WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy everything else and build
COPY . .
RUN npm run build

# Stage 2: Run the app with only necessary files
FROM node:18

WORKDIR /usr/src/app

# Copy only the necessary files from the builder stage
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/start.sh ./start.sh

# Make the start script executable
RUN chmod +x ./start.sh

EXPOSE 8001
CMD ["./start.sh"]
