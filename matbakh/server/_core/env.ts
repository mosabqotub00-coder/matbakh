// Runtime configuration is read at use time from the server environment only.
export const ENV = {
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
