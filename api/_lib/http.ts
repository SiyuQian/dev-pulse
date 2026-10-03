import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface ApiResponse extends ServerResponse {
  status(code: number): this
  json(body: unknown): this
  send(body: unknown): this
  redirect(status: number, location: string): this
}
