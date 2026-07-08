FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ bash

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p public/uploads data && chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/chatwave.db

CMD ["/bin/sh", "/app/scripts/docker-entrypoint.sh"]
