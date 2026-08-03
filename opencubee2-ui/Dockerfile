FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_BACKEND_BASE_URL=http://localhost:21081
ARG VITE_ASSET_BASE_URL=/keyframes
ARG VITE_VIDEO_BACKEND_BASE_URL=http://localhost:21081
ENV VITE_BACKEND_BASE_URL=$VITE_BACKEND_BASE_URL
ENV VITE_ASSET_BASE_URL=$VITE_ASSET_BASE_URL
ENV VITE_VIDEO_BACKEND_BASE_URL=$VITE_VIDEO_BACKEND_BASE_URL

COPY package*.json ./
RUN npm install ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
