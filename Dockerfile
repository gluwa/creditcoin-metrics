# Build stage: compile TypeScript and install production-only dependencies
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build

WORKDIR /usr/app
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# Runtime stage: distroless Node, no shell or package manager, runs as non-root
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b8cec4b2f2126ff7bd034ec9ac207ffb3272667dfdc48376e3b035d3270549ba

WORKDIR /usr/app
ENV NODE_ENV=production
COPY --from=build /usr/app/package.json ./
COPY --from=build /usr/app/node_modules ./node_modules
COPY --from=build /usr/app/dist ./dist

USER nonroot
EXPOSE 8080

CMD ["dist/index.js"]
