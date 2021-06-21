import { isAbsolute, join, normalize, sep, Sha1, Status } from "./deps.ts";
import { createHttpError } from "./httpError.ts";
const ENCODE_CHARS_REGEXP = /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
const HTAB = "\t".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
const UNMATCHED_SURROGATE_PAIR_REGEXP = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;
const UNMATCHED_SURROGATE_PAIR_REPLACE = "$1\uFFFD$2";
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
    return `${prefix}${new Sha1().update(crypto.getRandomValues(new Uint8Array(256))).hex()}${extension ? `.${extension}` : ""}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInV0aWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBRUEsT0FBTyxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBQzNFLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQUdqRCxNQUFNLG1CQUFtQixHQUN2QiwwR0FBMEcsQ0FBQztBQUM3RyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2hDLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5QixNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzlCLE1BQU0sK0JBQStCLEdBQ25DLDBFQUEwRSxDQUFDO0FBQzdFLE1BQU0sZ0NBQWdDLEdBQUcsWUFBWSxDQUFDO0FBS3RELE1BQU0sVUFBVSxlQUFlLENBQUMsSUFBWTtJQUMxQyxJQUFJO1FBQ0YsT0FBTyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUNqQztJQUFDLE1BQU07UUFDTixPQUFPLElBQUksQ0FBQztLQUNiO0FBQ0gsQ0FBQztBQUdELE1BQU0sVUFBVSxTQUFTLENBQUMsR0FBVztJQUNuQyxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUM7U0FDZixPQUFPLENBQUMsK0JBQStCLEVBQUUsZ0NBQWdDLENBQUM7U0FDMUUsT0FBTyxDQUFDLG1CQUFtQixFQUFFLFNBQVMsQ0FBQyxDQUFDO0FBQzdDLENBQUM7QUFFRCxNQUFNLFVBQVUsaUJBQWlCLENBQUMsTUFBTSxHQUFHLEVBQUUsRUFBRSxTQUFTLEdBQUcsRUFBRTtJ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