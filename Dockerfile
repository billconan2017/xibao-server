# 喜宝IPTV 后端 + 管理后台
FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY package.json ./
RUN npm install --omit=dev

# 复制源码
COPY src ./src
COPY web ./web

# 数据目录挂载点
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8080
ENV XIBAO_DB_PATH=/app/data/xibao.db

EXPOSE 8080

CMD ["node", "src/server.js"]
