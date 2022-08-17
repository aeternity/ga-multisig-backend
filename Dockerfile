FROM node:lts-alpine

# Create app directory
WORKDIR /app

COPY package.json .
COPY yarn.lock .

RUN yarn

COPY . .

EXPOSE 3000
CMD [ "node", "src/index.js" ]
