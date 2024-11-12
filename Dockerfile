# Use the official Node.js 20.11.0 image from the Docker Hub
FROM node:20.11.0

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy all files from the current directory to the working directory in the container
COPY . .

RUN yarn