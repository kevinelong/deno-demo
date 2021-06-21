import { isListenTlsOptions } from "./util.ts";
export const DomResponse = Response;
const serveHttp = "serveHttp" in Deno
    ?
        Deno.serveHttp.bind(Deno)
    : undefined;
export function hasNativeHttp() {
    return !!serveHttp;
}
export class NativeRequest {
    #conn;
    #reject;
    #request;
    #requestPromise;
    #resolve;
    #resolved = false;
    constructor(requestEvent, conn) {
        this.#conn = conn;
        this.#request = requestEvent.request;
        const p = new Promise((resolve, reject) => {
            this.#resolve = resolve;
            this.#reject = reject;
        });
        this.#requestPromise = requestEvent.respondWith(p);
    }
    get body() {
        return this.#request.body;
    }
    get donePromise() {
        return this.#requestPromise;
    }
    get headers() {
        return this.#request.headers;
    }
    get method() {
        return this.#request.method;
    }
    get remoteAddr() {
        return this.#conn?.remoteAddr.hostname;
    }
    get request() {
        return this.#request;
    }
    get url() {
        try {
            const url = new URL(this.#request.url);
            return this.#request.url.replace(url.origin, "");
        }
        catch {
        }
        return this.#request.url;
    }
    get rawUrl() {
        return this.#request.url;
    }
    error(reason) {
        if (this.#resolved) {
            throw new Error("Request already responded to.");
        }
        this.#reject(reason);
        this.#resolved = true;
    }
    respond(response) {
        if (this.#resolved) {
            throw new Error("Request already responded to.");
        }
        this.#resolve(response);
        this.#resolved = true;
        return this.#requestPromise;
    }
}
export class HttpServerNative {
    #app;
    #closed = false;
    #listener;
    #options;
    constructor(app, options) {
        if (!("serveHttp" in Deno)) {
            throw new Error("The native bindings for serving HTTP are not available.");
        }
        this.#app = app;
        this.#options = options;
    }
    get app() {
        return this.#app;
    }
    get closed() {
        return this.#closed;
    }
    close() {
        this.#closed = true;
        if (this.#listener) {
            this.#listener.close();
            this.#listener = undefined;
        }
    }
    [Symbol.asyncIterator]() {
        const start = (controller) => {
            const server = this;
            const listener = this.#listener = isListenTlsOptions(this.#options)
                ? Deno.listenTls(this.#options)
                : Deno.listen(this.#options);
            async function serve(conn) {
                const httpConn = serveHttp(conn);
                while (true) {
                    try {
                        const requestEvent = await httpConn.nextRequest();
                        if (requestEvent === null) {
                            return;
                        }
                        const nativeRequest = new NativeRequest(requestEvent, conn);
                        controller.enqueue(nativeRequest);
                        await nativeRequest.donePromise;
                    }
                    catch (error) {
                        server.app.dispatchEvent(new ErrorEvent("error", { error }));
                    }
                    if (server.closed) {
                        httpConn.close();
                        controller.close();
                    }
                }
            }
            async function accept() {
                while (true) {
                    try {
                        const conn = await listener.accept();
                        serve(conn);
                    }
                    catch (error) {
                        if (!server.closed) {
                            server.app.dispatchEvent(new ErrorEvent("error", { error }));
                        }
                    }
                    if (server.closed) {
                        controller.close();
                        return;
                    }
                }
            }
            accept();
        };
        const stream = new ReadableStream({ start });
        return stream[Symbol.asyncIterator]();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHR0cF9zZXJ2ZXJfbmF0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaHR0cF9zZXJ2ZXJfbmF0aXZlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUlBLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUcvQyxNQUFNLENBQUMsTUFBTSxXQUFXLEdBQW9CLFFBQVEsQ0FBQztBQWlCckQsTUFBTSxTQUFTLEdBQWtDLFdBQVcsSUFBSSxJQUFJO0lBQ2xFLENBQUM7UUFDRSxJQUFZLENBQUMsU0FBUyxDQUFDLElBQUksQ0FDMUIsSUFBSSxDQUNMO0lBQ0gsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQU1kLE1BQU0sVUFBVSxhQUFhO0lBQzNCLE9BQU8sQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUNyQixDQUFDO0FBRUQsTUFBTSxPQUFPLGFBQWE7SUFDeEIsS0FBSyxDQUFhO0lBRWxCLE9BQU8sQ0FBMEI7SUFDakMsUUFBUSxDQUFVO0lBQ2xCLGVBQWUsQ0FBZ0I7SUFDL0IsUUFBUSxDQUE2QjtJQUNyQyxTQUFTLEdBQUcsS0FBSyxDQUFDO0lBRWxCLFlBQVksWUFBMEIsRUFBRSxJQUFnQjtRQUN0RCxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQztRQUNsQixJQUFJLENBQUMsUUFBUSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUM7UUFDckMsTUFBTSxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQVcsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDbEQsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUM7WUFDeEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUM7UUFDeEIsQ0FBQyxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsZUFBZSxHQUFHLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVELElBQUksSUFBSTtRQUNOLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxJ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