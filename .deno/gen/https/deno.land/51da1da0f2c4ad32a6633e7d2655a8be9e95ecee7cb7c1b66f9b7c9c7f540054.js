import { assert, concat, contentType, copyBytes, Status } from "./deps.ts";
import { createHttpError } from "./httpError.ts";
import { calculate } from "./etag.ts";
import { DEFAULT_CHUNK_SIZE } from "./util.ts";
const ETAG_RE = /(?:W\/)?"[ !#-\x7E\x80-\xFF]+"/;
export function ifRange(value, mtime, entity) {
    if (value) {
        const matches = value.match(ETAG_RE);
        if (matches) {
            const [match] = matches;
            if (calculate(entity) === match) {
                return true;
            }
        }
        else {
            return new Date(value).getTime() >= mtime;
        }
    }
    return false;
}
export function parseRange(value, size) {
    const ranges = [];
    const [unit, rangesStr] = value.split("=");
    if (unit !== "bytes") {
        throw createHttpError(Status.RequestedRangeNotSatisfiable);
    }
    for (const range of rangesStr.split(/\s*,\s+/)) {
        const item = range.split("-");
        if (item.length !== 2) {
            throw createHttpError(Status.RequestedRangeNotSatisfiable);
        }
        const [startStr, endStr] = item;
        let start;
        let end;
        try {
            if (startStr === "") {
                start = size - parseInt(endStr, 10) - 1;
                end = size - 1;
            }
            else if (endStr === "") {
                start = parseInt(startStr, 10);
                end = size - 1;
            }
            else {
                start = parseInt(startStr, 10);
                end = parseInt(endStr, 10);
            }
        }
        catch {
            throw createHttpError();
        }
        if (start < 0 || start >= size || end < 0 || end >= size || start >= end) {
            throw createHttpError(Status.RequestedRangeNotSatisfiable);
        }
        ranges.push({ start, end });
    }
    return ranges;
}
async function readRange(file, range) {
    let length = range.end - range.start + 1;
    assert(length);
    await file.seek(range.start, Deno.SeekMode.Start);
    const result = new Uint8Array(length);
    let off = 0;
    while (length) {
        const p = new Uint8Array(Math.min(length, DEFAULT_CHUNK_SIZE));
        const nread = await file.read(p);
        assert(nread !== null, "Unexpected EOF encountered when reading a range.");
        assert(nread > 0, "Unexpected read of 0 bytes while reading a range.");
        copyBytes(p, result, off);
        off += nread;
        length -= nread;
        assert(length >= 0, "Unexpected length remaining.");
    }
    return result;
}
export class MultiPartStream extends ReadableStream {
    #contentLength;
    constructor(file, type, ranges, size, boundary) {
        const encoder = new TextEncoder();
        const resolvedType = contentType(type);
        if (!resolvedType) {
            throw new TypeError(`Could not resolve media type for "${type}"`);
        }
        const preamble = encoder.encode(`\n--${boundary}\nContent-Type: ${resolvedType}\n`);
        const postscript = encoder.encode(`\n--${boundary}--\n`);
        super({
            async pull(controller) {
                const range = ranges.shift();
                if (!range) {
                    controller.enqueue(postscript);
                    controller.close();
                    if (!(file instanceof Uint8Array)) {
                        file.close();
                    }
                    return;
                }
                let bytes;
                if (file instanceof Uint8Array) {
                    bytes = file.subarray(range.start, range.end + 1);
                }
                else {
                    bytes = await readRange(file, range);
                }
                const rangeHeader = encoder.encode(`Content-Range: ${range.start}-${range.end}/${size}\n\n`);
                controller.enqueue(concat(preamble, rangeHeader, bytes));
            },
        });
        this.#contentLength = ranges.reduce((prev, { start, end }) => {
            return prev + preamble.length + String(start).length +
                String(end).length + String(size).length + 20 + (end - start);
        }, postscript.length);
    }
    contentLength() {
        return this.#contentLength;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmFuZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyYW5nZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFFQSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUMzRSxPQUFPLEVBQUUsZUFBZSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDakQsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUV0QyxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsTUFBTSxXQUFXLENBQUM7QUFFL0MsTUFBTSxPQUFPLEdBQUcsZ0NBQWdDLENBQUM7QUFVakQsTUFBTSxVQUFVLE9BQU8sQ0FDckIsS0FBYSxFQUNiLEtBQWEsRUFDYixNQUE2QjtJQUU3QixJQUFJLEtBQUssRUFBRTtRQUNULE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDckMsSUFBSSxPQUFPLEVBQUU7WUFDWCxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsT0FBTyxDQUFDO1lBQ3hCLElBQUksU0FBUyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEtBQUssRUFBRTtnQkFDL0IsT0FBTyxJQUFJLENBQUM7YUFDYjtTQUNGO2FBQU07WUFDTCxPQUFPLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE9BQU8sRUFBRSxJQUFJLEtBQUssQ0FBQztTQUMzQztLQUNGO0lBQ0QsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQsTUFBTSxVQUFVLFVBQVUsQ0FBQyxLQUFhLEVBQUUsSUFBWTtJQUNwRCxNQUFNLE1BQU0sR0FBZ0IsRUFBRSxDQUFDO0lBQy9CLE1BQU0sQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxJQUFJLElBQUksS0FBSyxPQUFPLEVBQUU7UUFDcEIsTUFB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