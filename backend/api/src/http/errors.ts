/**
 * Error format (docs/03-api.md, "Hata biçimi"):
 * { error: { code, message, details } } with status from API_ERROR_HTTP_STATUS.
 */
import {
  API_ERROR_HTTP_STATUS,
  type ApiError as ApiErrorBody,
  type ApiErrorCode,
} from "@chargemesh/shared";
import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get statusCode(): number {
    return API_ERROR_HTTP_STATUS[this.code];
  }
}

export function errorBody(code: ApiErrorCode, message: string, details: unknown = null): ApiErrorBody {
  return { error: { code, message, details } };
}

export function sendError(
  reply: FastifyReply,
  code: ApiErrorCode,
  message: string,
  details: unknown = null,
): FastifyReply {
  return reply.status(API_ERROR_HTTP_STATUS[code]).send(errorBody(code, message, details));
}

/** Placeholder response for routes whose business logic lands in M1. */
export function notImplemented(reply: FastifyReply): FastifyReply {
  return reply.status(501).send(errorBody("INTERNAL", "Not implemented (M1)"));
}

function isFastifyError(err: unknown): err is FastifyError {
  return err instanceof Error && typeof (err as Partial<FastifyError>).code === "string";
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, "NOT_FOUND", `Route ${request.method} ${request.url.split("?")[0]} not found`);
  });

  app.setErrorHandler((err: unknown, request, reply) => {
    if (err instanceof ApiError) {
      return sendError(reply, err.code, err.message, err.details);
    }
    if (err instanceof ZodError) {
      return sendError(reply, "VALIDATION_ERROR", "Request validation failed", err.issues);
    }
    if (isFastifyError(err) && err.statusCode !== undefined && err.statusCode < 500) {
      // Framework-level client errors: malformed JSON, unsupported media type, body too large...
      return sendError(reply, "VALIDATION_ERROR", err.message, { fastifyCode: err.code });
    }
    request.log.error({ err }, "Unhandled error");
    return sendError(reply, "INTERNAL", "Internal server error");
  });
}
