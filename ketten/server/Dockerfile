FROM node:22-alpine
WORKDIR /app
COPY shared ./shared
COPY server ./server
WORKDIR /app/server
RUN npm init -y && npm install ws@8.21.3
ENV PORT=8787
EXPOSE 8787
CMD ["node", "index.js"]
