
FROM node:22-alpine3.21 AS builder
WORKDIR /app
COPY package*.json .
RUN npm install
COPY . .
RUN npx @vercel/ncc build

FROM node:22-alpine3.21
WORKDIR /app
COPY --from=builder /app/node_modules/ffmpeg-static/ffmpeg /usr/local/bin/
COPY --from=builder /app/dist/index.js index.js
CMD ["node", "index.js"]
