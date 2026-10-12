FROM node:24-alpine
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node *.mjs ./
USER node
EXPOSE 3313
CMD ["node", "server.mjs"]
