FROM node:24-bookworm-slim
WORKDIR /home/node/app
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node server.js ./
COPY --chown=node:node src/conversation ./src/conversation
COPY --chown=node:node public/shared/conversation ./public/shared/conversation
COPY --chown=node:node public/modern/conversation ./public/modern/conversation
COPY --chown=node:node docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p /data && chown node:node /data && chmod 755 ./docker-entrypoint.sh
USER node
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s CMD ["node", "src/conversation/healthcheck.js"]
ENTRYPOINT ["./docker-entrypoint.sh"]
