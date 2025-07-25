
FROM node:lts-alpine3.22
WORKDIR /app
COPY package.json package-lock.json .
RUN npm install
COPY . .
CMD [ "npm", "start"]