# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install all dependencies
RUN npm install
RUN cd backend && npm install
RUN cd frontend && npm install

# Copy source code
COPY backend ./backend
COPY frontend ./frontend

# Build backend
RUN cd backend && npm run build

# Build frontend
RUN cd frontend && npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/dist

# Copy built frontend to be served by backend
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy scripts for migrations
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend

CMD ["node", "dist/index.js"]
