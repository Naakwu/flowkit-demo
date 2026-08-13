FROM nginx:1.27-alpine

COPY deploy/docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY apps/web/src /usr/share/nginx/html
EXPOSE 8080
