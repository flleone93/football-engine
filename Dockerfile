FROM node:20-alpine

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
