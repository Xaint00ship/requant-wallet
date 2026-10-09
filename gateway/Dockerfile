FROM node:24-bookworm-slim
WORKDIR /app
COPY server.mjs package.json ./
ENV NODE_ENV=production PORT=3312
USER node
EXPOSE 3312
CMD ["node","server.mjs"]
