FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3000
CMD npx prisma db push --accept-data-loss 2>&1 && npm run start -- -p 3000 -H 0.0.0.0
