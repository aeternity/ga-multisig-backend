FROM node:18-alpine

# Create app directory
WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm ci

COPY . .

EXPOSE 3000
CMD [ "npm", "run", "server:dockerenv" ]
