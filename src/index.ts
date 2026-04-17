import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";

const app = buildApp();

app.listen({ port, host })
  .then(() => {
    app.log.info({ port, host }, "hh mock api listening");
  })
  .catch((error) => {
    app.log.error(error, "failed to start hh mock api");
    process.exit(1);
  });
