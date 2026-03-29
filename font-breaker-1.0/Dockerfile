# Use the official Node.js 20 image
FROM node:20-slim

# Install build dependencies (sometimes needed for native modules)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json and package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy local code to the container image.
COPY . .

# Build the application
RUN npm run build

# Bind the app to port 3000
EXPOSE 3000

# Run the web service on container startup.
CMD [ "npm", "start" ]
