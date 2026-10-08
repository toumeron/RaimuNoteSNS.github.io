FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /worker
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/external-notifications.mjs server/external-notification-listener.mjs server/external-notification-events.mjs ./server/
COPY supabase/functions/check-external-notifications/sources.ts ./supabase/functions/check-external-notifications/sources.ts
USER node
CMD ["node", "server/external-notifications.mjs"]
