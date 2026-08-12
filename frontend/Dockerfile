# --- Frontend Dockerfile ---
# Serves the static SPA with nginx and proxies /api/* to the backend service.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
EXPOSE 80