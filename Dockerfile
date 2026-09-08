FROM node:22-alpine

# Create app directory
WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD [ "npm", "run", "server:dockerenv" ]
