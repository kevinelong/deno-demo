import { decode, encode } from "../encoding/utf8.ts";
import { hasOwnProperty } from "../_util/has_own_property.ts";
import { BufReader, BufWriter } from "../io/bufio.ts";
import { readLong, readShort, sliceLongToBytes } from "../io/ioutil.ts";
import { Sha1 } from "../hash/sha1.ts";
import { writeResponse } from "../http/_io.ts";
import { TextProtoReader } from "../textproto/mod.ts";
import { deferred } from "../async/deferred.ts";
import { assert } from "../_util/assert.ts";
import { concat } from "../bytes/mod.ts";
export var OpCode;
(function (OpCode) {
    OpCode[OpCode["Continue"] = 0] = "Continue";
    OpCode[OpCode["TextFrame"] = 1] = "TextFrame";
    OpCode[OpCode["BinaryFrame"] = 2] = "BinaryFrame";
    OpCode[OpCode["Close"] = 8] = "Close";
    OpCode[OpCode["Ping"] = 9] = "Ping";
    OpCode[OpCode["Pong"] = 10] = "Pong";
})(OpCode || (OpCode = {}));
export function isWebSocketCloseEvent(a) {
    return hasOwnProperty(a, "code");
}
export function isWebSocketPingEvent(a) {
    return Array.isArray(a) && a[0] === "ping" && a[1] instanceof Uint8Array;
}
export function isWebSocketPongEvent(a) {
    return Array.isArray(a) && a[0] === "pong" && a[1] instanceof Uint8Array;
}
export function unmask(payload, mask) {
    if (mask) {
        for (let i = 0, len = payload.length; i < len; i++) {
            payload[i] ^= mask[i & 3];
        }
    }
}
export async function writeFrame(frame, writer) {
    const payloadLength = frame.payload.byteLength;
    let header;
    const hasMask = frame.mask ? 0x80 : 0;
    if (frame.mask && frame.mask.byteLength !== 4) {
        throw new Error("invalid mask. mask must be 4 bytes: length=" + frame.mask.byteLength);
    }
    if (payloadLength < 126) {
        header = new Uint8Array([0x80 | frame.opcode, hasMask | payloadLength]);
    }
    else if (payloadLength < 0xffff) {
        header = new Uint8Array([
            0x80 | frame.opcode,
            hasMask | 0b01111110,
            payloadLength >>> 8,
            payloadLength & 0x00ff,
        ]);
    }
    else {
        header = new Uint8Array([
            0x80 | frame.opcode,
            hasMask | 0b01111111,
            ...sliceLongToBytes(payloadLength),
        ]);
    }
    if (frame.mask) {
        header = concat(header, frame.mask);
    }
    unmask(frame.payload, frame.mask);
    header = concat(header, frame.payload);
    const w = BufWriter.create(writer);
    await w.write(header);
    await w.flush();
}
export async function readFrame(buf) {
    let b = await buf.readByte();
    assert(b !== null);
    let isLastFrame = false;
    switch (b >>> 4) {
        case 0b1000:
            isLastFrame = true;
            break;
        case 0b0000:
            isLastFrame = false;
            break;
        default:
            throw new Error("invalid signature");
    }
    const opcode = b & 0x0f;
    b = await buf.readByte();
    assert(b !== null);
    const hasMask = b >>> 7;
    let payloadLength = b & 0b01111111;
    if (payloadLength === 126) {
        const l = await readShort(buf);
        assert(l !== null);
        payloadLength = l;
    }
    else if (payloadLength === 127) {
        const l = await readLong(buf);
        assert(l !== null);
        payloadLength = Number(l);
    }
    let mask;
    if (hasMask) {
        mask = new Uint8Array(4);
        assert((await buf.readFull(mask)) !== null);
    }
    const payload = new Uint8Array(payloadLength);
    assert((await buf.readFull(payload)) !== null);
    return {
        isLastFrame,
        opcode,
        mask,
        payload,
    };
}
class WebSocketImpl {
    conn;
    mask;
    bufReader;
    bufWriter;
    sendQueue = [];
    constructor({ conn, bufReader, bufWriter, mask, }) {
        this.conn = conn;
        this.mask = mask;
        this.bufReader = bufReader || new BufReader(conn);
        this.bufWriter = bufWriter || new BufWriter(conn);
    }
    async *[Symbol.asyncIterator]() {
        let frames = [];
        let payloadsLength = 0;
        while (!this._isClosed) {
            let frame;
            try {
                frame = await readFrame(this.bufReader);
            }
            catch (e) {
                this.ensureSocketClosed();
                break;
            }
            unmask(frame.payload, frame.mask);
            switch (frame.opcode) {
                case OpCode.TextFrame:
                case OpCode.BinaryFrame:
                case OpCode.Continue:
                    frames.push(frame);
                    payloadsLength += frame.payload.length;
                    if (frame.isLastFrame) {
                        const concat = new Uint8Array(payloadsLength);
                        let offs = 0;
                        for (const frame of frames) {
                            concat.set(frame.payload, offs);
                            offs += frame.payload.length;
                        }
                        if (frames[0].opcode === OpCode.TextFrame) {
                            yield decode(concat);
                        }
                        else {
                            yield concat;
                        }
                        frames = [];
                        payloadsLength = 0;
                    }
                    break;
                case OpCode.Close: {
                    const code = (frame.payload[0] << 8) | frame.payload[1];
                    const reason = decode(frame.payload.subarray(2, frame.payload.length));
                    await this.close(code, reason);
                    yield { code, reason };
                    return;
                }
                case OpCode.Ping:
                    await this.enqueue({
                        opcode: OpCode.Pong,
                        payload: frame.payload,
                        isLastFrame: true,
                    });
                    yield ["ping", frame.payload];
                    break;
                case OpCode.Pong:
                    yield ["pong", frame.payload];
                    break;
                default:
            }
        }
    }
    dequeue() {
        const [entry] = this.sendQueue;
        if (!entry)
            return;
        if (this._isClosed)
            return;
        const { d, frame } = entry;
        writeFrame(frame, this.bufWriter)
            .then(() => d.resolve())
            .catch((e) => d.reject(e))
            .finally(() => {
            this.sendQueue.shift();
            this.dequeue();
        });
    }
    enqueue(frame) {
        if (this._isClosed) {
            throw new Deno.errors.ConnectionReset("Socket has already been closed");
        }
        const d = deferred();
        this.sendQueue.push({ d, frame });
        if (this.sendQueue.length === 1) {
            this.dequeue();
        }
        return d;
    }
    send(data) {
        const opcode = typeof data === "string"
            ? OpCode.TextFrame
            : OpCode.BinaryFrame;
        const payload = typeof data === "string" ? encode(data) : data;
        const isLastFrame = true;
        const frame = {
            isLastFrame,
            opcode,
            payload,
            mask: this.mask,
        };
        return this.enqueue(frame);
    }
    ping(data = "") {
        const payload = typeof data === "string" ? encode(data) : data;
        const frame = {
            isLastFrame: true,
            opcode: OpCode.Ping,
            mask: this.mask,
            payload,
        };
        return this.enqueue(frame);
    }
    _isClosed = false;
    get isClosed() {
        return this._isClosed;
    }
    async close(code = 1000, reason) {
        try {
            const header = [code >>> 8, code & 0x00ff];
            let payload;
            if (reason) {
                const reasonBytes = encode(reason);
                payload = new Uint8Array(2 + reasonBytes.byteLength);
                payload.set(header);
                payload.set(reasonBytes, 2);
            }
            else {
                payload = new Uint8Array(header);
            }
            await this.enqueue({
                isLastFrame: true,
                opcode: OpCode.Close,
                mask: this.mask,
                payload,
            });
        }
        catch (e) {
            throw e;
        }
        finally {
            this.ensureSocketClosed();
        }
    }
    closeForce() {
        this.ensureSocketClosed();
    }
    ensureSocketClosed() {
        if (this.isClosed)
            return;
        try {
            this.conn.close();
        }
        catch (e) {
            console.error(e);
        }
        finally {
            this._isClosed = true;
            const rest = this.sendQueue;
            this.sendQueue = [];
            rest.forEach((e) => e.d.reject(new Deno.errors.ConnectionReset("Socket has already been closed")));
        }
    }
}
export function acceptable(req) {
    const upgrade = req.headers.get("upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return false;
    }
    const secKey = req.headers.get("sec-websocket-key");
    return (req.headers.has("sec-websocket-key") &&
        typeof secKey === "string" &&
        secKey.length > 0);
}
const kGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export function createSecAccept(nonce) {
    const sha1 = new Sha1();
    sha1.update(nonce + kGUID);
    const bytes = sha1.digest();
    return btoa(String.fromCharCode(...bytes));
}
export async function acceptWebSocket(req) {
    const { conn, headers, bufReader, bufWriter } = req;
    if (acceptable(req)) {
        const sock = new WebSocketImpl({ conn, bufReader, bufWriter });
        const secKey = headers.get("sec-websocket-key");
        if (typeof secKey !== "string") {
            throw new Error("sec-websocket-key is not provided");
        }
        const secAccept = createSecAccept(secKey);
        const newHeaders = new Headers({
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Accept": secAccept,
        });
        const secProtocol = headers.get("sec-websocket-protocol");
        if (typeof secProtocol === "string") {
            newHeaders.set("Sec-WebSocket-Protocol", secProtocol);
        }
        const secVersion = headers.get("sec-websocket-version");
        if (typeof secVersion === "string") {
            newHeaders.set("Sec-WebSocket-Version", secVersion);
        }
        await writeResponse(bufWriter, {
            status: 101,
            headers: newHeaders,
        });
        return sock;
    }
    throw new Error("request is not acceptable");
}
const kSecChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-.~_";
export function createSecKey() {
    let key = "";
    for (let i = 0; i < 16; i++) {
        const j = Math.floor(Math.random() * kSecChars.length);
        key += kSecChars[j];
    }
    return btoa(key);
}
export async function handshake(url, headers, bufReader, bufWriter) {
    const { hostname, pathname, search } = url;
    const key = createSecKey();
    if (!headers.has("host")) {
        headers.set("host", hostname);
    }
    headers.set("upgrade", "websocket");
    headers.set("connection", "upgrade");
    headers.set("sec-websocket-key", key);
    headers.set("sec-websocket-version", "13");
    let headerStr = `GET ${pathname}${search} HTTP/1.1\r\n`;
    for (const [key, value] of headers) {
        headerStr += `${key}: ${value}\r\n`;
    }
    headerStr += "\r\n";
    await bufWriter.write(encode(headerStr));
    await bufWriter.flush();
    const tpReader = new TextProtoReader(bufReader);
    const statusLine = await tpReader.readLine();
    if (statusLine === null) {
        throw new Deno.errors.UnexpectedEof();
    }
    const m = statusLine.match(/^(?<version>\S+) (?<statusCode>\S+) /);
    if (!m) {
        throw new Error("ws: invalid status line: " + statusLine);
    }
    assert(m.groups);
    const { version, statusCode } = m.groups;
    if (version !== "HTTP/1.1" || statusCode !== "101") {
        throw new Error(`ws: server didn't accept handshake: ` +
            `version=${version}, statusCode=${statusCode}`);
    }
    const responseHeaders = await tpReader.readMIMEHeader();
    if (responseHeaders === null) {
        throw new Deno.errors.UnexpectedEof();
    }
    const expectedSecAccept = createSecAccept(key);
    const secAccept = responseHeaders.get("sec-websocket-accept");
    if (secAccept !== expectedSecAccept) {
        throw new Error(`ws: unexpected sec-websocket-accept header: ` +
            `expected=${expectedSecAccept}, actual=${secAccept}`);
    }
}
export function createWebSocket(params) {
    return new WebSocketImpl(params);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibW9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0scUJBQXFCLENBQUM7QUFDckQsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLDhCQUE4QixDQUFDO0FBQzlELE9BQU8sRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEQsT0FBTyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUN4RSxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFDdkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLGdCQUFnQixDQUFDO0FBQy9DLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUN0RCxPQUFPLEVBQVksUUFBUSxFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDMUQsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLG9CQUFvQixDQUFDO0FBQzVDLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUV6QyxNQUFNLENBQU4sSUFBWSxNQU9YO0FBUEQsV0FBWSxNQUFNO0lBQ2hCLDJDQUFjLENBQUE7SUFDZCw2Q0FBZSxDQUFBO0lBQ2YsaURBQWlCLENBQUE7SUFDakIscUNBQVcsQ0FBQTtJQUNYLG1DQUFVLENBQUE7SUFDVixvQ0FBVSxDQUFBO0FBQ1osQ0FBQyxFQVBXLE1BQU0sS0FBTixNQUFNLFFBT2pCO0FBZUQsTUFBTSxVQUFVLHFCQUFxQixDQUNuQyxDQUFpQjtJQUVqQixPQUFPLGNBQWMsQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDbkMsQ0FBQztBQUtELE1BQU0sVUFBVSxvQkFBb0IsQ0FDbEMsQ0FBaUI7SUFFakIsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FB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