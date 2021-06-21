import { createHash, isAbsolute, join, normalize, sep, Status, } from "./deps.ts";
import { createHttpError } from "./httpError.ts";
const ENCODE_CHARS_REGEXP = /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
const HTAB = "\t".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
const UNMATCHED_SURROGATE_PAIR_REGEXP = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;
const UNMATCHED_SURROGATE_PAIR_REPLACE = "$1\uFFFD$2";
export const DEFAULT_CHUNK_SIZE = 16_640;
export const BODY_TYPES = ["string", "number", "bigint", "boolean", "symbol"];
export function decodeComponent(text) {
    try {
        return decodeURIComponent(text);
    }
    catch {
        return text;
    }
}
export function encodeUrl(url) {
    return String(url)
        .replace(UNMATCHED_SURROGATE_PAIR_REGEXP, UNMATCHED_SURROGATE_PAIR_REPLACE)
        .replace(ENCODE_CHARS_REGEXP, encodeURI);
}
export function getRandomFilename(prefix = "", extension = "") {
    return `${prefix}${createHash("sha1").update(crypto.getRandomValues(new Uint8Array(256)))
        .toString("hex")}${extension ? `.${extension}` : ""}`;
}
export function getBoundary() {
    return `oak_${createHash("sha1").update(crypto.getRandomValues(new Uint8Array(256)))
        .toString("hex")}`;
}
export function isAsyncIterable(value) {
    return typeof value === "object" && value !== null &&
        Symbol.asyncIterator in value &&
        typeof value[Symbol.asyncIterator] === "function";
}
export function isReader(value) {
    return typeof value === "object" && value !== null && "read" in value &&
        typeof value.read === "function";
}
function isCloser(value) {
    return typeof value === "object" && value != null && "close" in value &&
        typeof value["close"] === "function";
}
export function isConn(value) {
    return typeof value === "object" && value != null && "rid" in value &&
        typeof value.rid === "number" && "localAddr" in value &&
        "remoteAddr" in value;
}
export function isListenTlsOptions(value) {
    return typeof value === "object" && value !== null && "certFile" in value &&
        "keyFile" in value && "port" in value;
}
export function readableStreamFromReader(reader, options = {}) {
    const { autoClose = true, chunkSize = DEFAULT_CHUNK_SIZE, strategy, } = options;
    return new ReadableStream({
        async pull(controller) {
            const chunk = new Uint8Array(chunkSize);
            try {
                const read = await reader.read(chunk);
                if (read === null) {
                    if (isCloser(reader) && autoClose) {
                        reader.close();
                    }
                    controller.close();
                    return;
                }
                controller.enqueue(chunk.subarray(0, read));
            }
            catch (e) {
                controller.error(e);
                if (isCloser(reader)) {
                    reader.close();
                }
            }
        },
        cancel() {
            if (isCloser(reader) && autoClose) {
                reader.close();
            }
        },
        type: "bytes",
    }, strategy);
}
export function isErrorStatus(value) {
    return [
        Status.BadRequest,
        Status.Unauthorized,
        Status.PaymentRequired,
        Status.Forbidden,
        Status.NotFound,
        Status.MethodNotAllowed,
        Status.NotAcceptable,
        Status.ProxyAuthRequired,
        Status.RequestTimeout,
        Status.Conflict,
        Status.Gone,
        Status.LengthRequired,
        Status.PreconditionFailed,
        Status.RequestEntityTooLarge,
        Status.RequestURITooLong,
        Status.UnsupportedMediaType,
        Status.RequestedRangeNotSatisfiable,
        Status.ExpectationFailed,
        Status.Teapot,
        Status.MisdirectedRequest,
        Status.UnprocessableEntity,
        Status.Locked,
        Status.FailedDependency,
        Status.UpgradeRequired,
        Status.PreconditionRequired,
        Status.TooManyRequests,
        Status.RequestHeaderFieldsTooLarge,
        Status.UnavailableForLegalReasons,
        Status.InternalServerError,
        Status.NotImplemented,
        Status.BadGateway,
        Status.ServiceUnavailable,
        Status.GatewayTimeout,
        Status.HTTPVersionNotSupported,
        Status.VariantAlsoNegotiates,
        Status.InsufficientStorage,
        Status.LoopDetected,
        Status.NotExtended,
        Status.NetworkAuthenticationRequired,
    ].includes(value);
}
export function isRedirectStatus(value) {
    return [
        Status.MultipleChoices,
        Status.MovedPermanently,
        Status.Found,
        Status.SeeOther,
        Status.UseProxy,
        Status.TemporaryRedirect,
        Status.PermanentRedirect,
    ].includes(value);
}
export function isHtml(value) {
    return /^\s*<(?:!DOCTYPE|html|body)/i.test(value);
}
export function skipLWSPChar(u8) {
    const result = new Uint8Array(u8.length);
    let j = 0;
    for (let i = 0; i < u8.length; i++) {
        if (u8[i] === SPACE || u8[i] === HTAB)
            continue;
        result[j++] = u8[i];
    }
    return result.slice(0, j);
}
export function stripEol(value) {
    if (value[value.byteLength - 1] == LF) {
        let drop = 1;
        if (value.byteLength > 1 && value[value.byteLength - 2] === CR) {
            drop = 2;
        }
        return value.subarray(0, value.byteLength - drop);
    }
    return value;
}
const UP_PATH_REGEXP = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
export function resolvePath(rootPath, relativePath) {
    let path = relativePath;
    let root = rootPath;
    if (relativePath === undefined) {
        path = rootPath;
        root = ".";
    }
    if (path == null) {
        throw new TypeError("Argument relativePath is required.");
    }
    if (path.includes("\0")) {
        throw createHttpError(400, "Malicious Path");
    }
    if (isAbsolute(path)) {
        throw createHttpError(400, "Malicious Path");
    }
    if (UP_PATH_REGEXP.test(normalize("." + sep + path))) {
        throw createHttpError(403);
    }
    return normalize(join(root, path));
}
export class Uint8ArrayTransformStream extends TransformStream {
    constructor() {
        const init = {
            async transform(chunk, controller) {
                chunk = await chunk;
                switch (typeof chunk) {
                    case "object":
                        if (chunk === null) {
                            controller.terminate();
                        }
                        else if (ArrayBuffer.isView(chunk)) {
                            controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
                        }
                        else if (Array.isArray(chunk) &&
                            chunk.every((value) => typeof value === "number")) {
                            controller.enqueue(new Uint8Array(chunk));
                        }
                        else if (typeof chunk.valueOf === "function" && chunk.valueOf() !== chunk) {
                            this.transform(chunk.valueOf(), controller);
                        }
                        else if ("toJSON" in chunk) {
                            this.transform(JSON.stringify(chunk), controller);
                        }
                        break;
                    case "symbol":
                        controller.error(new TypeError("Cannot transform a symbol to a Uint8Array"));
                        break;
                    case "undefined":
                        controller.error(new TypeError("Cannot transform undefined to a Uint8Array"));
                        break;
                    default:
                        controller.enqueue(this.encoder.encode(String(chunk)));
                }
            },
            encoder: new TextEncoder(),
        };
        super(init);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInV0aWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBRUEsT0FBTyxFQUNMLFVBQVUsRUFDVixVQUFVLEVBQ1YsSUFBSSxFQUNKLFNBQVMsRUFDVCxHQUFHLEVBQ0gsTUFBTSxHQUNQLE1BQU0sV0FBVyxDQUFDO0FBQ25CLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQUdqRCxNQUFNLG1CQUFtQixHQUN2QiwwR0FBMEcsQ0FBQztBQUM3RyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2hDLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5QixNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlCLE1BQU0sK0JBQStCLEdBQ25DLDBFQUEwRSxDQUFDO0FBQzdFLE1BQU0sZ0NBQWdDLEdBQUcsWUFBWSxDQUFDO0FBQ3RELE1BQU0sQ0FBQyxNQUFNLGtCQUFrQixHQUFHLE1BQU0sQ0FBQztBQUd6QyxNQUFNLENBQUMsTUFBTSxVQUFVLEdBQUcsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFLOUUsTUFBTSxVQUFVLGVBQWUsQ0FBQyxJQUFZO0lBQzFDLElBQUk7UUFDRixPQUFPLGtCQUFrQixDQUFDLElBQUksQ0FBQyxDQUFDO0tBQ2pDO0lBQUMsTUFBTTtRQUNOLE9BQU8sSUFBSSxDQUFDO0tBQ2I7QUFDSCxDQUFDO0FBR0QsTUFBTSxVQUFVLFNBQVMsQ0FBQyxHQUFXO0lBQ25DLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQztTQUNmLE9BQU8sQ0FBQywrQkFBK0IsRUFBRSxnQ0FBZ0MsQ0FBQztTQUMxRSxPQUFPLENBQUMsbUJBQW1CLEVBQUUsU0FBUyxDQUFDLENBQUM7QUFDN0MsQ0FBQztBQUVELE1BQU0sVUFBVSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsRUFBRSxFQUFFLFNBQVMsR0FBRyxFQUFFO0lBQzNELE9BQU8sR0FBRyxNQUFNLEdBQ2QsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7U0FDbkUsUUFBUSxDQUFDLEtBQUssQ0FDbkIsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ3hDLENBQUM7QUFFRCxNQUFNLFVBQVUsV0FBVztJQUN6QixPQUFPLE9BQ0wsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7U0FDbkUsUUFBUSxDQUFDLEtBQUssQ0FDbkIsRUFBRSxDQUFDO0FBQ0wsQ0FBQztBQUlELE1BQU0sVUFBVSxlQUFlLENBQUMsS0FBYztJQUM1QyxPQUFPLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEtBQUssSUFBSTtRQUNoRCxNQUFNLENBQUMsYUFBYSxJQUFJLEtBQUs7UUFFN0IsT0FBUSxLQUFhLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxLQUFLLFVBQVUsQ0FBQztBQUMvRCxDQUFDO0FBR0QsTUFBTSxVQUFVLFFBQVEsQ0FBQyxLQUFjO0lBQ3JDLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksTUFBTSxJQUFJLEtBQUs7UUFDbkUsT0FBUSxLQUFpQyxDQUFDLElBQUksS0FBSyxVQUFVLENBQUM7QUFDbEUsQ0FBQztBQUVELFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxPQUFPLElBQUksS0FBSztRQUVuRSxPQUFRLEtBQTZCLENBQUMsT0FBTyxDQUFDLEtBQUssVUFBVSxDQUFDO0FBQ2xFLENBQUM7QUFFRCxNQUFNLFVBQVUsTUFBTSxDQUFDLEtBQWM7SUFDbkMsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLElBQUksS0FBSztRQUVqRSxPQUFRLEtBQWEsQ0FBQyxHQUFHLEtBQUssUUFBUSxJQUFJLFdBQVcsSUFBSSxLQUFLO1FBQzlELFlBQVksSUFBSSxLQUFLLENBQUM7QUFDMUIsQ0FBQztBQUVELE1BQU0sVUFBVSxrQkFBa0IsQ0FDaEMsS0FBYztJQUVkLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksVUFBVSxJQUFJLEtBQUs7UUFDdkUsU0FBUyxJQUFJLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDO0FBQzFDLENBQUM7QUFrQ0QsTUFBTSxVQUFVLHdCQUF3QixDQUN0QyxNQUFpRCxFQUNqRCxVQUEyQyxFQUFFO0lBRTdDLE1BQU0sRUFDSixTQUFTLEdBQUcsSUFBSSxFQUNoQixTQUFTLEdBQUcsa0JBQWtCLEVBQzlCLFFBQVEsR0FDVCxHQUFHLE9BQU8sQ0FBQztJQUVaLE9BQU8sSUFBSSxjQUFjLENBQUM7UUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQ25CLE1BQU0sS0FBSyxHQUFHLElBQUksVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3hDLElBQUk7Z0JBQ0YsTUFBTSxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUN0QyxJQUFJLElBQUksS0FBSyxJQUFJLEVBQUU7b0JBQ2pCLElBQUksUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFNBQVMsRUFBRTt3QkFDakMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO3FCQUNoQjtvQkFDRCxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUM7b0JBQ25CLE9BQU87aUJBQ1I7Z0JBQ0QsVUFBVSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO2FBQzdDO1lBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ1YsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsSUFBSSxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUU7b0JBQ3BCLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztpQkFDaEI7YUFDRjtRQUNILENBQUM7UUFDRCxNQUFNO1lBQ0osSUFBSSxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksU0FBUyxFQUFFO2dCQUNqQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7YUFDaEI7UUFDSCxDQUFDO1FBQ0QsSUFBSSxFQUFFLE9BQU87S0FDZCxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQ2YsQ0FBQztBQUdELE1BQU0sVUFBVSxhQUFhLENBQUMsS0FBYTtJQUN6QyxPQUFPO1FBQ0wsTUFBTSxDQUFDLFVBQVU7UUFDakIsTUFBTSxDQUFDLFlBQVk7UUFDbkIsTUFBTSxDQUFDLGVBQWU7UUFDdEIsTUFBTSxDQUFDLFNBQVM7UUFDaEIsTUFBTSxDQUFDLFFBQVE7UUFDZixNQUFNLENBQUMsZ0JBQWdCO1FBQ3ZCLE1BQU0sQ0FBQyxhQUFhO1FBQ3BCLE1BQU0sQ0FBQyxpQkFBaUI7UUFDeEIsTUFBTSxDQUFDLGNBQWM7UUFDckIsTUFBTSxDQUFDLFFBQVE7UUFDZixNQUFNLENBQUMsSUFBSTtRQUNYLE1BQU0sQ0FBQyxjQUFjO1FBQ3JCLE1BQU0sQ0FBQyxrQkFBa0I7UUFDekIsTUFBTSxDQUFDLHFCQUFxQjtRQUM1QixNQUFNLENBQUMsaUJBQWlCO1FBQ3hCLE1BQU0sQ0FBQyxvQkFBb0I7UUFDM0IsTUFBTSxDQUFDLDRCQUE0QjtRQUNuQyxNQUFNLENBQUMsaUJBQWlCO1FBQ3hCLE1BQU0sQ0FBQyxNQUFNO1FBQ2IsTUFBTSxDQUFDLGtCQUFrQjtRQUN6QixNQUFNLENBQUMsbUJBQW1CO1FBQzFCLE1BQU0sQ0FBQyxNQUFNO1FBQ2IsTUFBTSxDQUFDLGdCQUFnQjtRQUN2QixNQUFNLENBQUMsZUFBZTtRQUN0QixNQUFNLENBQUMsb0JBQW9CO1FBQzNCLE1BQU0sQ0FBQyxlQUFlO1FBQ3RCLE1BQU0sQ0FBQywyQkFBMkI7UUFDbEMsTUFBTSxDQUFDLDBCQUEwQjtRQUNqQyxNQUFNLENBQUMsbUJBQW1CO1FBQzFCLE1BQU0sQ0FBQyxjQUFjO1FBQ3JCLE1BQU0sQ0FBQyxVQUFVO1FBQ2pCLE1BQU0sQ0FBQyxrQkFBa0I7UUFDekIsTUFBTSxDQUFDLGNBQWM7UUFDckIsTUFBTSxDQUFDLHVCQUF1QjtRQUM5QixNQUFNLENBQUMscUJBQXFCO1FBQzVCLE1BQU0sQ0FBQyxtQkFBbUI7UUFDMUIsTUFBTSxDQUFDLFlBQVk7UUFDbkIsTUFBTSxDQUFDLFdBQVc7UUFDbEIsTUFBTSxDQUFDLDZCQUE2QjtLQUNyQyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNwQixDQUFDO0FBR0QsTUFBTSxVQUFVLGdCQUFnQixDQUFDLEtBQWE7SUFDNUMsT0FBTztRQUNMLE1BQU0sQ0FBQyxlQUFlO1FBQ3RCLE1BQU0sQ0FBQyxnQkFBZ0I7UUFDdkIsTUFBTSxDQUFDLEtBQUs7UUFDWixNQUFNLENBQUMsUUFBUTtRQUNmLE1BQU0sQ0FBQyxRQUFRO1FBQ2YsTUFBTSxDQUFDLGlCQUFpQjtRQUN4QixNQUFNLENBQUMsaUJBQWlCO0tBQ3pCLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3BCLENBQUM7QUFHRCxNQUFNLFVBQVUsTUFBTSxDQUFDLEtBQWE7SUFDbEMsT0FBTyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDcEQsQ0FBQztBQUdELE1BQU0sVUFBVSxZQUFZLENBQUMsRUFBYztJQUN6QyxNQUFNLE1BQU0sR0FBRyxJQUFJLFVBQVUsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDekMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ1YsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDbEMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJO1lBQUUsU0FBUztRQUNoRCxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7S0FDckI7SUFDRCxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzVCLENBQUM7QUFFRCxNQUFNLFVBQVUsUUFBUSxDQUFDLEtBQWlCO0lBQ3hDLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFO1FBQ3JDLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztRQUNiLElBQUksS0FBSyxDQUFDLFVBQVUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQzlELElBQUksR0FBRyxDQUFDLENBQUM7U0FDVjtRQUNELE9BQU8sS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsQ0FBQztLQUNuRDtJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQStCRCxNQUFNLGNBQWMsR0FBRyw0QkFBNEIsQ0FBQztBQUlwRCxNQUFNLFVBQVUsV0FBVyxDQUFDLFFBQWdCLEVBQUUsWUFBcUI7SUFDakUsSUFBSSxJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3hCLElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQztJQUdwQixJQUFJLFlBQVksS0FBSyxTQUFTLEVBQUU7UUFDOUIsSUFBSSxHQUFHLFFBQVEsQ0FBQztRQUNoQixJQUFJLEdBQUcsR0FBRyxDQUFDO0tBQ1o7SUFFRCxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7UUFDaEIsTUFBTSxJQUFJLFNBQVMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO0tBQzNEO0lBR0QsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3ZCLE1BQU0sZUFBZSxDQUFDLEdBQUcsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0tBQzlDO0lBR0QsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDcEIsTUFBTSxlQUFlLENBQUMsR0FBRyxFQUFFLGdCQUFnQixDQUFDLENBQUM7S0FDOUM7SUFHRCxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUNwRCxNQUFNLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQztLQUM1QjtJQUdELE9BQU8sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNyQyxDQUFDO0FBR0QsTUFBTSxPQUFPLHlCQUNYLFNBQVEsZUFBb0M7SUFDNUM7UUFDRSxNQUFNLElBQUksR0FBRztZQUNYLEtBQUssQ0FBQyxTQUFTLENBQ2IsS0FBYyxFQUNkLFVBQXdEO2dCQUV4RCxLQUFLLEdBQUcsTUFBTSxLQUFLLENBQUM7Z0JBQ3BCLFFBQVEsT0FBTyxLQUFLLEVBQUU7b0JBQ3BCLEtBQUssUUFBUTt3QkFDWCxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUU7NEJBQ2xCLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQzt5QkFDeEI7NkJBQU0sSUFBSSxXQUFXLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFOzRCQUNwQyxVQUFVLENBQUMsT0FBTyxDQUNoQixJQUFJLFVBQVUsQ0FDWixLQUFLLENBQUMsTUFBTSxFQUNaLEtBQUssQ0FBQyxVQUFVLEVBQ2hCLEtBQUssQ0FBQyxVQUFVLENBQ2pCLENBQ0YsQ0FBQzt5QkFDSDs2QkFBTSxJQUNMLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDOzRCQUNwQixLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsRUFDakQ7NEJBQ0EsVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO3lCQUMzQzs2QkFBTSxJQUNMLE9BQU8sS0FBSyxDQUFDLE9BQU8sS0FBSyxVQUFVLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLEtBQUssRUFDaEU7NEJBQ0EsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUM7eUJBQzdDOzZCQUFNLElBQUksUUFBUSxJQUFJLEtBQUssRUFBRTs0QkFDNUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxFQUFFLFVBQVUsQ0FBQyxDQUFDO3lCQUNuRDt3QkFDRCxNQUFNO29CQUNSLEtBQUssUUFBUTt3QkFDWCxVQUFVLENBQUMsS0FBSyxDQUNkLElBQUksU0FBUyxDQUFDLDJDQUEyQyxDQUFDLENBQzNELENBQUM7d0JBQ0YsTUFBTTtvQkFDUixLQUFLLFdBQVc7d0JBQ2QsVUFBVSxDQUFDLEtBQUssQ0FDZCxJQUFJLFNBQVMsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUM1RCxDQUFDO3dCQUNGLE1BQU07b0JBQ1I7d0JBQ0UsVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO2lCQUMxRDtZQUNILENBQUM7WUFDRCxPQUFPLEVBQUUsSUFBSSxXQUFXLEVBQUU7U0FDM0IsQ0FBQztRQUNGLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNkLENBQUM7Q0FDRiJ9