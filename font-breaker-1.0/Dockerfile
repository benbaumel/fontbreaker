# Use the official Node.js 20 image
FROM node:20-slim

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy local code
COPY . .

# Build the application
RUN npm run build

# Bind the app to port 3000
EXPOSE 3000

# Run the web service
CMD [ "npm", "start" ]
