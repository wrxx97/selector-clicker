import type { Buffer } from "node:buffer";

export interface StoreRequestOptions extends Omit<RequestInit, "body"> {
  body?: string | URLSearchParams | Buffer;
}

type StoreRequest = (url: string, options: StoreRequestOptions) => Promise<Response>;

interface ReviewSubmission {
  archive: Buffer;
  version: string;
  publisherId: string;
  itemId: string;
  accessToken: string;
}

export function getAccessToken(serviceAccountJson: string, request?: StoreRequest): Promise<string>;
export function submitForReview(
  submission: ReviewSubmission,
  options?: { request?: StoreRequest; delay?: (milliseconds: number) => Promise<void> }
): Promise<{ state?: string }>;
