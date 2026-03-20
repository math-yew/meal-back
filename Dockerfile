# Use a slim version of Node.js for a smaller, faster image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker's cache for faster builds
COPY package*.json ./

# Install only production dependencies (saves space)
RUN npm install --omit=dev

# Copy the rest of your application code
COPY . .

# Expose the port Back4app will use (they default to 8080 or the PORT env var)
EXPOSE 8080

# The command to start your app
# Note: I'm using server.js since that's what you named your file
CMD ["node", "server.js"]