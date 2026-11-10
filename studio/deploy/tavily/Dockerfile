FROM node:22-alpine
WORKDIR /srv
COPY --chown=node:node server.cjs ./
USER node
EXPOSE 18093
CMD ["node", "server.cjs"]
