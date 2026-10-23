FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Directory where the PersistentVolumeClaim will mount
RUN mkdir -p /usr/src/app/files

ENV PORT=8080
ENV CACHE_DIR=/usr/src/app/files

EXPOSE 8080

CMD ["node", "server.js"]