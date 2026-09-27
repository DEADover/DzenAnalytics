# build stage
# --------------------
FROM node:26-alpine AS build

WORKDIR /app/

COPY package*.json /app/

# Строго по lock-файлу: образ собирается одинаково раз от раза.
RUN npm ci

COPY . /app/

RUN npm run build

# nginx stage
# --------------------
FROM nginx:mainline

RUN mkdir /var/www/html/ -p

ENV NGINX_PORT=8000
EXPOSE 8000/tcp

COPY --from=build /app/dist/ /var/www/html/

COPY docker/nginx.conf /etc/nginx/templates/dzenalitics.conf.template
