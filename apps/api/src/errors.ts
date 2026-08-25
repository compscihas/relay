import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    httpErrors: {
      badRequest(message: string): Error & { statusCode: number };
      unauthorized(message: string): Error & { statusCode: number };
      forbidden(message: string): Error & { statusCode: number };
      notFound(message: string): Error & { statusCode: number };
      conflict(message: string): Error & { statusCode: number };
    };
  }
}

function statusError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export default fp(async (app: FastifyInstance) => {
  app.decorate("httpErrors", {
    badRequest: (message) => statusError(400, message),
    unauthorized: (message) => statusError(401, message),
    forbidden: (message) => statusError(403, message),
    notFound: (message) => statusError(404, message),
    conflict: (message) => statusError(409, message),
  });
});

