# Stage 1: Build React SPA static assets
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Nginx Reverse Proxy + Static Asset Server
FROM nginx:1.27-alpine
RUN apk add --no-cache curl

# Remove default configuration
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy custom Traffic Management nginx.conf and custom 429 page
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/429.html /usr/share/nginx/html/429.html

# Copy built React SPA from Stage 1
COPY --from=frontend-builder /frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
