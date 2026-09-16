# 喜宝IPTV 后端 + 管理后台
FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制源码
COPY src ./src
COPY web ./web

# 数据目录挂载点
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8080
ENV XIBAO_DB_PATH=/app/data/xibao.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
