import { AsyncIterableReader } from "./async_iterable_reader.ts";
import { contentType, readerFromStreamReader, Status, STATUS_TEXT, } from "./deps.ts";
import { DomResponse } from "./http_server_native.ts";
import { BODY_TYPES, encodeUrl, isAsyncIterable, isHtml, isReader, isRedirectStatus, readableStreamFromReader, Uint8ArrayTransformStream, } from "./util.ts";
export const REDIRECT_BACK = Symbol("redirect backwards");
const encoder = new TextEncoder();
function toUint8Array(body) {
    let bodyText;
    if (BODY_TYPES.includes(typeof body)) {
        bodyText = String(body);
    }
    else {
        bodyText = JSON.stringify(body);
    }
    return encoder.encode(bodyText);
}
async function convertBodyToBodyInit(body, type) {
    let result;
    if (BODY_TYPES.includes(typeof body)) {
        result = String(body);
        type = type ?? (isHtml(result) ? "html" : "text/plain");
    }
    else if (isReader(body)) {
        result = readableStreamFromReader(body);
    }
    else if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer ||
        body instanceof Blob || body instanceof URLSearchParams) {
        result = body;
    }
    else if (body instanceof ReadableStream) {
        result = body.pipeThrough(new Uint8ArrayTransformStream());
    }
    else if (body instanceof FormData) {
        result = body;
        type = "multipart/form-data";
    }
    else if (body && typeof body === "object") {
        result = JSON.stringify(body);
        type = type ?? "json";
    }
    else if (typeof body === "function") {
        const result = body.call(null);
        return convertBodyToBodyInit(await result, type);
    }
    else if (body) {
        throw new TypeError("Response body was set but could not be converted.");
    }
    return [result, type];
}
async function convertBodyToStdBody(body, type) {
    let result;
    if (BODY_TYPES.includes(typeof body)) {
        const bodyText = String(body);
        result = encoder.encode(bodyText);
        type = type ?? (isHtml(bodyText) ? "html" : "text/plain");
    }
    else if (body instanceof Uint8Array || isReader(body)) {
        result = body;
    }
    else if (body instanceof ReadableStream) {
        result = readerFromStreamReader(body.pipeThrough(new Uint8ArrayTransformStream()).getReader());
    }
    else if (isAsyncIterable(body)) {
        result = new AsyncIterableReader(body, toUint8Array);
    }
    else if (body && typeof body === "object") {
        result = encoder.encode(JSON.stringify(body));
        type = type ?? "json";
    }
    else if (typeof body === "function") {
        const result = body.call(null);
        return convertBodyToStdBody(await result, type);
    }
    else if (body) {
        throw new TypeError("Response body was set but could not be converted.");
    }
    return [result, type];
}
export class Response {
    #body;
    #bodySet = false;
    #domResponse;
    #headers = new Headers();
    #request;
    #resources = [];
    #serverResponse;
    #status;
    #type;
    #writable = true;
    #getBodyInit = async () => {
        const [body, type] = await convertBodyToBodyInit(this.body, this.type);
        this.type = type;
        return body;
    };
    #getStdBody = async () => {
        const [body, type] = await convertBodyToStdBody(this.body, this.type);
        this.type = type;
        return body;
    };
    #setContentType = () => {
        if (this.type) {
            const contentTypeString = contentType(this.type);
            if (contentTypeString && !this.headers.has("Content-Type")) {
                this.headers.append("Content-Type", contentTypeString);
            }
        }
    };
    get body() {
        return this.#body;
    }
    set body(value) {
        if (!this.#writable) {
            throw new Error("The response is not writable.");
        }
        this.#bodySet = true;
        this.#body = value;
    }
    get headers() {
        return this.#headers;
    }
    set headers(value) {
        if (!this.#writable) {
            throw new Error("The response is not writable.");
        }
        this.#headers = value;
    }
    get status() {
        if (this.#status) {
            return this.#status;
        }
        return this.body != null
            ? Status.OK
            : this.#bodySet
                ? Status.NoContent
                : Status.NotFound;
    }
    set status(value) {
        if (!this.#writable) {
            throw new Error("The response is not writable.");
        }
        this.#status = value;
    }
    get type() {
        return this.#type;
    }
    set type(value) {
        if (!this.#writable) {
            throw new Error("The response is not writable.");
        }
        this.#type = value;
    }
    get writable() {
        return this.#writable;
    }
    constructor(request) {
        this.#request = request;
    }
    addResource(rid) {
        this.#resources.push(rid);
    }
    destroy(closeResources = true) {
        this.#writable = false;
        this.#body = undefined;
        this.#serverResponse = undefined;
        this.#domResponse = undefined;
        if (closeResources) {
            for (const rid of this.#resources) {
                Deno.close(rid);
            }
        }
    }
    redirect(url, alt = "/") {
        if (url === REDIRECT_BACK) {
            url = this.#request.headers.get("Referrer") ?? String(alt);
        }
        else if (typeof url === "object") {
            url = String(url);
        }
        this.headers.set("Location", encodeUrl(url));
        if (!this.status || !isRedirectStatus(this.status)) {
            this.status = Status.Found;
        }
        if (this.#request.accepts("html")) {
            url = encodeURI(url);
            this.type = "text/html; charset=utf-8";
            this.body = `Redirecting to <a href="${url}">${url}</a>.`;
            return;
        }
        this.type = "text/plain; charset=utf-8";
        this.body = `Redirecting to ${url}.`;
    }
    async toDomResponse() {
        if (this.#domResponse) {
            return this.#domResponse;
        }
        const bodyInit = await this.#getBodyInit();
        this.#setContentType();
        const { headers } = this;
        if (!(bodyInit ||
            headers.has("Content-Type") ||
            headers.has("Content-Length"))) {
            headers.append("Content-Length", "0");
        }
        this.#writable = false;
        const status = this.status;
        const responseInit = {
            headers,
            status,
            statusText: STATUS_TEXT.get(status),
        };
        return this.#domResponse = new DomResponse(bodyInit, responseInit);
    }
    async toServerResponse() {
        if (this.#serverResponse) {
            return this.#serverResponse;
        }
        const body = await this.#getStdBody();
        this.#setContentType();
        const { headers } = this;
        if (!(body ||
            headers.has("Content-Type") ||
            headers.has("Content-Length"))) {
            headers.append("Content-Length", "0");
        }
        this.#writable = false;
        return this.#serverResponse = {
            body,
            headers,
            status: this.status,
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzcG9uc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyZXNwb25zZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFFQSxPQUFPLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSw0QkFBNEIsQ0FBQztBQUNqRSxPQUFPLEVBQ0wsV0FBVyxFQUNYLHNCQUFzQixFQUN0QixNQUFNLEVBQ04sV0FBVyxHQUNaLE1BQU0sV0FBVyxDQUFDO0FBQ25CLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSx5QkFBeUIsQ0FBQztBQUd0RCxPQUFPLEVBQ0wsVUFBVSxFQUNWLFNBQVMsRUFDVCxlQUFlLEVBQ2YsTUFBTSxFQUNOLFFBQVEsRUFDUixnQkFBZ0IsRUFDaEIsd0JBQXdCLEVBQ3hCLHlCQUF5QixHQUMxQixNQUFNLFdBQVcsQ0FBQztBQStCbkIsTUFBTSxDQUFDLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0FBRTFELE1BQU0sT0FBTyxHQUFHLElBQUksV0FBVyxFQUFFLENBQUM7QUFFbEMsU0FBUyxZQUFZLENBQUMsSUFBVTtJQUM5QixJQUFJLFFBQWdCLENBQUM7SUFDckIsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE9BQU8sSUFBSSxDQUFDLEVBQUU7UUFDcEMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUN6QjtTQUFNO1FBQ0wsUUFBUSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7S0FDakM7SUFDRCxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDbEMsQ0FBQztBQUVELEtBQUssVUFBVSxxQkFBcUIsQ0FDbEMsSUFBeUIsRUFDekIsSUFBYTtJQUViLElBQUksTUFBdUMsQ0FBQztJQUM1QyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsT0FBTyxJQUFJLENBQUMsRUFBRTtRQUNwQyxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFD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