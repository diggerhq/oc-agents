# Postgres-only: DATABASE_URL is required (set via fly secrets)
# fly secrets set DATABASE_URL="postgres://..." --app project-untitled
fly secrets set WORKOS_REDIRECT_URI="https://project-untitled.fly.dev/api/auth/workos/callback"