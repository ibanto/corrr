FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY tsconfig.json ./
RUN npm install -g tsx
EXPOSE 3000
CMD ["tsx", "src/routes/index.ts"]
