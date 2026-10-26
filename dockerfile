cat << 'EOF' > Dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip3 install --no-cache-dir --break-system-packages yfinance mplfinance pandas

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
EOF