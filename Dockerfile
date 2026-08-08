# Flight Wall — production container for Google Cloud Run.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies against the committed lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code.
COPY src ./src
COPY public ./public

# Cloud Run injects PORT (defaults to 8080); the server reads it.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
