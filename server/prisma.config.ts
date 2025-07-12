import { defineConfig } from 'prisma/config'

// Prisma CLI doesn't read .env on its own in v7; Node's built-in loader does it (no dotenv needed).
try {
  process.loadEnvFile()
} catch {
  // No .env file: rely on variables already set in the environment (CI, production).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL! },
})
